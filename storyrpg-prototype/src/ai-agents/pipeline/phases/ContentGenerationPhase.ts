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
import type { ValidatorExecutionRecord } from '../../../types/validation';
import { isPlanningRegisterText } from '../../constants/planningRegisterText';
import { AgentResponse } from '../../agents/BaseAgent';
import type { SemanticRealizationJudgeLike } from '../../agents/SemanticRealizationJudge';
import { BranchAnalysis, ReconvergencePoint } from '../../agents/BranchManager';
import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceAuthor, ChoiceAuthorInput, ChoiceSet } from '../../agents/ChoiceAuthor';
import {
  EncounterArchitect,
  EncounterArchitectInput,
  EncounterStructure,
  EncounterTelemetry,
  classifyPhaseError,
} from '../../agents/EncounterArchitect';
import {
  QuarantinedEncounterUnit,
  buildQuarantineRetryInput,
  runQuarantineRetryPass,
} from './encounterQuarantine';
import { GeneratedBeat, SceneContent, SceneWriter } from '../../agents/SceneWriter';
import { EpisodeBlueprint, SceneBlueprint } from '../../agents/StoryArchitect';
import { TwistPlan } from '../../agents/TwistArchitect';
import { WorldBible } from '../../agents/WorldBuilder';
import { applyChoiceResidueBackstop } from '../residueObligations';
import { RemediationBudget, shouldAttemptRemediation } from '../../remediation/RemediationBudget';
import { gateEnabledPredicate, isGateEnabled } from '../../remediation/gateDefaults';
import {
  analyzeEpisodeTreatmentDensity,
  describeTreatmentDensityReport,
  isUnsafeTreatmentDensityReport,
  type TreatmentDensityReport,
  unsafeTreatmentDensityReports,
} from '../../remediation/gateRepairRouter';
import {
  improvesMissingRealization,
  isNonStageableRequiredMomentSource,
  missingRequiredMoments,
  realizationRetryFeedback,
  rewriteLosesRequiredMoment,
} from '../../remediation/sceneRealizationGuard';
import { RemediationLedgerRecord } from '../../remediation/remediationLedger';
import { isChoiceRegenImprovement, shouldRegenChoices } from '../../remediation/regenChoicesPolicy';
import { shouldAdoptRegenAttempt } from '../../remediation/regenAdoption';
import { flagSceneForCritic } from '../../remediation/sceneCriticFlags';
import { resolveCharacterProfile } from '../../utils/characterProfileResolver';
import {
  buildSceneConstructionPromptView,
  applySceneConstructionProfilesToScenes,
} from '../../utils/sceneConstructionProfile';
import { attachSceneEventOwnershipProfiles, repairCausalCueOwnershipOrder } from '../../utils/sceneEventOwnership';
import { reprojectEpisodeEventPlan, validateCanonicalEpisodeBlueprintProjection } from '../narrativeContractCompiler';
import { finalizeEpisodeSceneOwnership } from '../../utils/episodeSceneOwnership';
import { normalizeRelationshipPacingStages } from '../../utils/relationshipPacingStagePolicy';
import { detectBeatTenseDrift, isSceneWideTenseDrift, sceneTenseCensus } from '../../utils/proseTense';
import { buildSceneDependencyGraph, buildTopologicalWaves } from '../../utils/dependencyGraph';
import { slugify as idSlugify } from '../../utils/idUtils';
import {
  forbiddenNpcNames,
  introducedNpcIds,
  isIntroducedNpc,
  npcIdsNamedInProse,
  resolveCharacterIntroMode,
  resolveRosterCharacter,
} from '../../utils/npcIntroductionLedger';
import { saveEarlyDiagnostic } from '../../utils/pipelineOutputWriter';
import {
  buildRealizedEpisodeSoFarSummary,
  buildRealizedSceneSummary,
  buildRealizedTimelineHandoff,
  resolveGraphPredecessor,
} from '../realizedContext';
import { StoryVerb } from '../../utils/storyVerbs';
import { PIPELINE_TIMEOUTS, withTimeout } from '../../utils/withTimeout';
import type { AgentMemoryRequest, AgentMemoryRole } from '../pipelineMemory';
import type { PipelineMemoryArtifactKind } from '../artifactMemoryTypes';
import {
  CharacterVoiceProfile,
  FinalStoryContractValidator,
  IncrementalValidationRunner,
  SceneGraphBranchValidator,
  SceneValidationResult,
  aggregateValidationResults,
} from '../../validators';
import { SceneOwnershipPreflightValidator } from '../../validators/SceneOwnershipPreflightValidator';
import {
  scanEncounterFallbackProseDetailed,
  scanEncounterTemplateProseDetailed,
  type EncounterProseScanHit,
} from '../../validators/EncounterQualityValidator';
import { convertEncounterStructureToEncounter } from '../../converters/encounterConverter';

function ensureCanonicalStateSetters(
  choices: ChoiceSet['choices'],
  requiredStateIds: string[] | undefined,
): void {
  for (const stateId of requiredStateIds ?? []) {
    if (choices.some((choice) => (choice.consequences ?? []).some(
      (consequence) => consequence.type === 'setFlag' && consequence.flag === stateId && consequence.value !== false,
    ))) continue;
    const stateTokens = stateId.split(/[^a-z0-9]+/i).filter((token) => token.length >= 4);
    const candidate = [...choices]
      .map((choice) => {
        const surface = [choice.text, choice.outcomeTexts?.success, choice.outcomeTexts?.partial, choice.outcomeTexts?.failure]
          .filter(Boolean).join(' ').toLowerCase();
        return { choice, score: stateTokens.filter((token) => surface.includes(token)).length };
      })
      .sort((a, b) => b.score - a.score)[0];
    // Do not attach an unrelated state to an option that does not stage a
    // compatible action; the final contract should remain blocking in that case.
    if (!candidate || candidate.score === 0) continue;
    candidate.choice.consequences = [
      ...(candidate.choice.consequences ?? []),
      { type: 'setFlag', flag: stateId, value: true } as never,
    ];
  }
}

/**
 * Keep pre-reveal identities anonymous even when an encounter model ignores a
 * prompt-only naming prohibition. This is a provenance-preserving rewrite of
 * generated encounter surfaces, not new story authorship: the canonical
 * character remains linked by id while reader-facing names use the scheduled
 * alias or a visual stranger reference.
 */
function scrubPreRevealIdentityReferences<T>(
  value: T,
  contracts: Array<{
    canonicalName: string;
    allowedAliases: string[];
    firstNamedEpisode: number;
  }> | undefined,
  episodeNumber: number,
): T {
  const replacements = (contracts ?? [])
    .filter((contract) => contract.firstNamedEpisode > episodeNumber && contract.canonicalName.trim())
    .flatMap((contract) => {
      const canonical = contract.canonicalName.trim();
      const firstName = canonical.split(/\s+/)[0];
      return [
        { pattern: canonical, replacement: contract.allowedAliases[0]?.trim() || 'the stranger' },
        ...(firstName.length >= 3 && firstName !== canonical
          ? [{ pattern: firstName, replacement: contract.allowedAliases[0]?.trim() || 'the stranger' }]
          : []),
      ];
    });
  if (replacements.length === 0) return value;

  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaceText = (text: string): string => replacements.reduce(
    (current, replacement) => current.replace(
      new RegExp(`\\b${escapeRegExp(replacement.pattern)}\\b`, 'gi'),
      replacement.replacement,
    ),
    text,
  );
  const walk = (input: unknown, key?: string): unknown => {
    if (typeof input === 'string') {
      if (key === 'id' || /(?:Id|ID)$/.test(key ?? '')) return input;
      return replaceText(input);
    }
    if (Array.isArray(input)) return input.map((item) => walk(item));
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        walk(entryValue, entryKey),
      ]),
    );
  };
  return walk(value) as T;
}

/**
 * Generation-time acceptance scan (no-boilerplate mandate): the
 * EncounterArchitect template signatures on the STRUCTURE plus registered
 * deterministic fallback prose (syntheticFallbackProse registry) on a TRIAL
 * CONVERSION of it. The converter injects its fallbacks for missing storylet
 * beats / stakes / choice outcomes at assembly time — AFTER the structure
 * scan — so without the trial conversion those strings only surfaced as
 * blocking `unsafe_fallback_prose` findings at the final contract, once every
 * remaining episode had already been paid for. Catching them here makes it a
 * cheap per-scene regeneration-with-feedback instead.
 *
 * Hits carry the ACTUAL offending text plus a source: 'template' = the
 * architect's own build-collapse filler (regeneration is the fix);
 * 'fallback' = a registry string DETERMINISTIC code injected because the LLM
 * omitted a field (the targeted cost-field re-author is the fix — whole-
 * encounter regen cannot converge on this class; see the 2026-07-06
 * encounter-cost postmortem).
 */
function scanEncounterBoilerplate(
  structure: EncounterStructure | undefined,
  sceneBlueprint: SceneBlueprint,
): EncounterProseScanHit[] {
  if (!structure) return [];
  const hits = new Map<string, EncounterProseScanHit>();
  for (const hit of scanEncounterTemplateProseDetailed(structure)) hits.set(hit.label, hit);
  try {
    for (const hit of scanEncounterFallbackProseDetailed(convertEncounterStructureToEncounter(structure, sceneBlueprint))) {
      if (!hits.has(hit.label)) hits.set(hit.label, hit);
    }
  } catch {
    // Trial conversion is best-effort; a genuine conversion crash surfaces at assembly.
  }
  return [...hits.values()];
}

/**
 * Feedback lines for regen prompts: the actual offending strings (never bare
 * registry labels), with deterministic-injection hits explained as MISSING
 * FIELDS the LLM must author rather than prose it must remove — the LLM never
 * wrote those strings, so "remove this fragment" was unactionable.
 */
function describeBoilerplateHits(hits: EncounterProseScanHit[], max = 6): string {
  return hits.slice(0, max).map((hit) => {
    if (hit.source === 'fallback') {
      return `- MISSING FIELD (the pipeline injected the placeholder "${hit.snippet}" because your output omitted the field — author it: ${hit.label})`;
    }
    return `- template filler to replace with bespoke prose: "${hit.snippet}"`;
  }).join('\n');
}
import { CallbackLedger } from '../callbackLedger';
import {
  mergeDuplicatePublicAftermathScenes,
  validateBlueprintRouteCueOrder,
} from '../blueprintRouteCuePreflight';
import { UnresolvedCallbackForPrompt, recordScenePayoffs } from '../callbackOrchestration';
import { capabilityNoteForProfile } from '../characterCanonFacts';
import { repairBranchFanOut } from '../choiceAssembly';
import { assignChoiceTypes } from '../choiceTypePlanner';
import {
  EpisodePlant,
  emitSceneBranchAxes,
  encounterInfoMarkerTargets,
  emitSceneInfoMarkers,
  emitSceneInfoMarkersOnBeats,
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
import { collectEncounterParticipantRefs, filterProtagonistEncounterRefs } from '../encounterParticipants';
import { assessEncounterTurnRealization, formatEncounterTurnRealizationFeedback } from '../encounterTurnRealizationGuard';
import { GenerationPlan, markSceneActive, setSceneBeats } from '../generationPlan';
import { buildOutcomeTextVariants } from '../outcomeVariants';
import { buildSceneSettingContext } from '../planningHelpers';
import { attachResidueRequirements } from '../reconvergenceResidue';
import { buildContinueInLocation, buildPriorEncounterOutcomes } from '../scenePreventionContext';
import { plannedConsequenceTiersByScene } from '../plannedSceneBudgets';
import { findChoiceSetForScene } from '../choiceSetLookup';
import { reconcileRelationshipPacingWithChoiceTypes } from '../relationshipPacingChoiceTypeReconciliation';
import { runBoundedDensityRepair } from '../boundedDensityRepair';
import {
  validateChoiceProducerOutput,
  validateEncounterProducerOutput,
  validateSceneProducerOutput,
  type ProducerBlockerFinding,
} from '../producerBlockerChecks';
import {
  prioritizeOwnerRepairFindings,
  shouldAdoptOwnerRepairCandidate,
  type RealizationTaskGateFinding,
} from '../realizationTaskGate';
import { validateSemanticRealizationTasks } from '../semanticValidationCoordinator';
import { inferNarrativeVerificationAuthority } from '../realizationVerificationAuthority';
import { applySceneSemanticPatch } from '../sceneSemanticPatch';
import type { NarrativeRealizationOwnerStage, NarrativeRealizationTask } from '../../../types/narrativeContract';
import { stableHash } from '../artifacts/store';
import { createValidatorExecutionRecord } from '../../validators/validatorExecutionRecords';

export type ContentGenerationResult = {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
  validationExecutionRecords: ValidatorExecutionRecord[];
};
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
  materializeTwistPlan,
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
import { isAuthoredLiteEpisode } from '../../utils/authoredLiteScenePlan';
import {
  applyCompiledThreadTwistToLedger,
  buildCompiledArcTargetsFromPlan,
  buildCompiledThreadTwistFromEsc,
} from '../../utils/compiledEscDirectives';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import {
  compactSceneWriterInput,
  droppedBlockingContracts,
  isSceneWriterCompactRetryReason,
  totalContractBlocks,
} from './sceneWriterInputCompaction';
import { PipelineContext } from './index';

function ownerRealizationRepairFeedback(
  finding: RealizationTaskGateFinding,
  tasks: NarrativeRealizationTask[] | undefined,
): string {
  const task = tasks?.find((candidate) => candidate.id === finding.taskId);
  const atomIds = new Set([
    ...(finding.missingEvidenceAtoms ?? []),
    ...(finding.matchedForbiddenAtoms ?? []),
  ]);
  const atoms = task?.evidenceAtoms.filter((atom) => atomIds.size === 0 || atomIds.has(atom.id)) ?? [];
  const requirements = atoms.map((atom) => {
    const authority = inferNarrativeVerificationAuthority(atom);
    if (authority === 'semantic_judge') {
      const temporalInstruction = atom.polarity === 'forbidden'
        ? ''
        : atom.temporalSlot === 'owner_event' || atom.semanticRole === 'action'
          ? ' Dramatize the action while it happens; do not begin after it is complete or summarize it as prior activity.'
          : '';
      return `${atom.polarity === 'forbidden' ? 'DO NOT COMMUNICATE' : 'MEANING TO REALIZE'}: ${atom.description}.${temporalInstruction}`;
    }
    return `${atom.polarity === 'forbidden' ? 'AVOID' : 'REQUIRE'} ${authority}: ${atom.acceptedPatterns.join(' / ')}`;
  });
  return `${finding.taskId}: ${finding.message}${requirements.length > 0 ? ` ${requirements.join('; ')}` : ''}`;
}

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
  sceneWriter: Pick<SceneWriter, 'execute' | 'executeSemanticPatch' | 'setContractLoadTemperature'>;
  choiceAuthor: Pick<ChoiceAuthor, 'execute' | 'setEpisodeSkillTargets'>;
  encounterArchitect: Pick<EncounterArchitect, 'execute' | 'reauthorFallbackCostFields'>;
  semanticRealizationJudge: SemanticRealizationJudgeLike;
  getThreadPlanner: () => ThreadPlannerLike;
  getTwistArchitect: () => TwistArchitectLike;
  getCharacterArcTracker: () => CharacterArcTrackerLike;
  writeAgentOutcome?: (record: {
    role: AgentMemoryRole;
    lifecycle: string;
    storyId?: string;
    episodeNumber?: number;
    artifactKinds?: PipelineMemoryArtifactKind[];
    outcome?: string;
    summary?: string;
    payload?: unknown;
  }) => Promise<void>;

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
  getAgentMemoryContext?: (request: AgentMemoryRequest) => Promise<string | null>;
  readonly callbackLedger: CallbackLedger;
  readonly dependencySchedulerStats: { hasCycle: boolean; waveCount: number; fallbackToSerial: boolean };
  readonly episodeArcTargets: Map<number, CharacterArcTargets>;
  readonly episodeTwistPlans: Map<number, TwistPlan>;
  readonly generationPlan: GenerationPlan | null;
  readonly remediationBudget: RemediationBudget | null;
  readonly seasonChoicePlan: SeasonChoicePlan | undefined;
  plannedChoiceTypesByScene: Record<string, string> | undefined;
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
  canLoadResumeUnit?: (episodeNumber: number | undefined, unitId: string) => boolean;
  loadResumeUnit: <T>(
    outputDirectory: string | undefined,
    unitId: string,
    artifactPath: string
  ) => T | undefined;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string }
  ) => Promise<void>;
  recordSceneValidationResult: (result: SceneValidationResult) => void;
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
  private outputDirectory?: string;
  private episodeNumber?: number;

  constructor(private readonly deps: ContentGenerationPhaseDeps) {}

  private async validateNarrativeRealization(input: {
    sceneId: string;
    tasks?: NarrativeRealizationTask[];
    sceneContent?: unknown;
    choiceSet?: unknown;
    encounter?: unknown;
    mode?: 'owner' | 'final_regression';
    currentStage?: NarrativeRealizationOwnerStage;
    candidateHash?: string;
  }) {
    const semantic = await validateSemanticRealizationTasks({
      ...input,
      judge: this.deps.semanticRealizationJudge,
    });
    const combinedFindings = semantic.findings;
    let receiptRef: string | undefined;
    if (this.outputDirectory) {
      const ownerStage = input.currentStage ?? 'scene_regression';
      const candidateHash = semantic.receipt.candidateHash;
      receiptRef = `episode-${this.episodeNumber ?? 1}-scene-${input.sceneId.replace(/[^a-z0-9_-]+/gi, '-')}-semantic-validation-${ownerStage}-${candidateHash.slice(0, 12)}.json`;
      await saveEarlyDiagnostic(this.outputDirectory, receiptRef, {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        episodeNumber: this.episodeNumber,
        sceneId: input.sceneId,
        ownerStage,
        mode: input.mode ?? 'owner',
        candidateHash,
        findings: combinedFindings,
        receipt: semantic.receipt,
      });
    }
    const unavailable = semantic.findings.filter((finding) => finding.code === 'SEMANTIC_VALIDATION_UNAVAILABLE');
    if (unavailable.length > 0) {
      throw new PipelineError(
        `[SemanticValidationUnavailable] ${input.sceneId} could not obtain semantic verdicts; content was not regenerated.`,
        'validation',
        {
          agent: 'SemanticRealizationJudge',
          context: { sceneId: input.sceneId, findings: unavailable, receipt: semantic.receipt },
          failure: {
            code: 'semantic_judge_unavailable',
            ownerStage: input.currentStage ?? 'scene_content',
            retryClass: 'retry_provider',
            issueCodes: ['SEMANTIC_VALIDATION_UNAVAILABLE'],
            artifactRefs: receiptRef ? [receiptRef] : [],
            repairTarget: unavailable[0]?.taskId ?? input.sceneId,
          },
        },
      );
    }
    const inconclusive = semantic.findings.filter((finding) => finding.code === 'SEMANTIC_VALIDATION_INCONCLUSIVE');
    if (inconclusive.length > 0 && input.mode === 'final_regression') {
      throw new PipelineError(
        `[SemanticValidationInconclusive] ${input.sceneId} could not obtain a stable semantic verdict; content was not regenerated.`,
        'validation',
        {
          agent: 'SemanticRealizationJudge',
          context: { sceneId: input.sceneId, findings: inconclusive, receipt: semantic.receipt },
          failure: {
            code: 'semantic_validation_inconclusive',
            ownerStage: input.currentStage ?? 'scene_content',
            retryClass: 'repair_final_contract',
            issueCodes: ['SEMANTIC_VALIDATION_INCONCLUSIVE'],
            artifactRefs: receiptRef ? [receiptRef] : [],
            repairTarget: inconclusive[0]?.taskId ?? input.sceneId,
          },
        },
      );
    }
    return { findings: combinedFindings, semanticReceipt: semantic.receipt };
  }

  private async memoryContextFor(
    role: AgentMemoryRole,
    lifecycle: string,
    brief: FullCreativeBrief,
    sceneBlueprint?: SceneBlueprint,
    artifactKinds: PipelineMemoryArtifactKind[] = [],
  ): Promise<string | undefined> {
    if (!this.deps.getAgentMemoryContext) return this.deps.cachedPipelineMemory || undefined;
    const block = await this.deps.getAgentMemoryContext({
      agentRole: role,
      lifecycle,
      storyId: brief.story.title,
      episodeNumber: brief.episode?.number,
      treatmentId: brief.multiEpisode?.sourceAnalysis?.sourceTitle,
      sceneId: sceneBlueprint?.id,
      characterIds: sceneBlueprint?.npcsPresent,
      artifactKinds,
    });
    return block || this.deps.cachedPipelineMemory || undefined;
  }

  /**
   * Authored-lite: seed season thread ledger + twist plan from ESC-compiled
   * obligations instead of calling ThreadPlanner / TwistArchitect LLMs.
   */
  private seedCompiledThreadTwistFromEsc(
    blueprint: EpisodeBlueprint,
    episodeNumber: number,
    context: PipelineContext,
    brief?: FullCreativeBrief,
  ): void {
    const spine = brief?.seasonPlan?.scenePlan?.episodeSpines?.[episodeNumber];
    const seed = buildCompiledThreadTwistFromEsc(blueprint, episodeNumber, spine);
    applyCompiledThreadTwistToLedger(this.deps.seasonThreadLedger, seed, episodeNumber);
    if (seed.threads.length > 0) {
      context.emit({
        type: 'debug',
        phase: 'content',
        message: `ESC-compiled thread ledger: ${seed.threads.length} thread(s) for episode ${episodeNumber}`,
      });
    }
    if (seed.twistPlan) {
      this.deps.episodeTwistPlans.set(episodeNumber, seed.twistPlan);
    }
  }

  /**
   * Authored-lite: seed ChoiceAuthor arc targets from season arcPressureContracts
   * / ESC polarity without CharacterArcTracker LLM.
   */
  private seedCompiledArcTargetsFromPlan(
    brief: FullCreativeBrief,
    episodeNumber: number,
    blueprint: EpisodeBlueprint,
  ): void {
    const arcTargets = buildCompiledArcTargetsFromPlan({
      episodeId: blueprint.episodeId,
      episodeNumber,
      contracts: brief.seasonPlan?.arcPressureContracts,
      polarityFacets: brief.seasonPlan?.scenePlan?.episodeSpines?.[episodeNumber]?.polarityFacets,
    });
    if (arcTargets) {
      this.deps.episodeArcTargets.set(episodeNumber, arcTargets);
    }
  }

  private sceneDensityCanExpandWithBeatBudget(report: TreatmentDensityReport, scene: SceneBlueprint | undefined): boolean {
    if (!scene) return false;
    const hardOverage = Math.max(0, report.hardUnits - report.threshold.hardUnits);
    if (hardOverage > 0) return false;
    if (report.threshold.profile === 'encounter') return false;
    if (report.explicitTimeJumpCount >= 2) return false;
    const recommendedBeatCount = scene.recommendedBeatCount ?? 0;
    if (recommendedBeatCount <= 0) return false;
    return recommendedBeatCount >= Math.ceil(report.totalUnits) + 1;
  }

  private buildVoiceProfiles(
    sceneBlueprint: SceneBlueprint,
    characterBible: CharacterBible,
  ): CharacterVoiceProfile[] {
    return (sceneBlueprint.npcsPresent || [])
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
  }

  private async recordResumedSceneValidation(params: {
    sceneBlueprint: SceneBlueprint;
    sceneContent: SceneContent;
    choiceSet?: ChoiceSet;
    encounter?: EncounterStructure;
    characterBible: CharacterBible;
    episodeNumber: number;
    encounterValidationEnabled: boolean;
    context: PipelineContext;
  }): Promise<void> {
    if (!this.deps.incrementalValidator) return;

    const {
      sceneBlueprint,
      sceneContent,
      choiceSet,
      encounter,
      characterBible,
      episodeNumber,
      encounterValidationEnabled,
      context,
    } = params;
    const voiceProfiles = this.buildVoiceProfiles(sceneBlueprint, characterBible);
    let sceneValidation = await this.deps.incrementalValidator.validateScene(
      sceneContent,
      choiceSet,
      voiceProfiles,
      undefined,
    );
    sceneValidation.episodeNumber = episodeNumber;

    if (encounter && encounterValidationEnabled) {
      const encounterValidation = this.deps.incrementalValidator.validators.encounter.validateEncounter(encounter);
      sceneValidation = {
        sceneId: sceneBlueprint.id,
        episodeNumber,
        sceneName: sceneBlueprint.name,
        encounter: encounterValidation,
        overallPassed: encounterValidation.passed,
        regenerationRequested: encounterValidation.passed ? 'none' : 'encounter',
        validationTimeMs: 0,
      };
    }

    this.deps.recordSceneValidationResult(sceneValidation);
    context.emit({
      type: 'incremental_validation',
      phase: encounter ? 'resumed_encounter' : 'resumed_scene',
      message: `Resumed scene ${sceneBlueprint.id}: ${sceneValidation.overallPassed ? 'PASSED' : 'ISSUES FOUND'}`,
      data: {
        sceneId: sceneBlueprint.id,
        episodeNumber,
        regenerationRequested: sceneValidation.regenerationRequested,
      },
    });
  }

  async run(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    branchAnalysis: BranchAnalysis | undefined,
    outputDirectory: string | undefined,
    episodeNumber: number | undefined,
    context: PipelineContext
  ): Promise<ContentGenerationResult> {
    this.outputDirectory = outputDirectory;
    this.episodeNumber = episodeNumber ?? brief.episode.number;
    const sceneContents: SceneContent[] = [];
    const choiceSets: ChoiceSet[] = [];
    // Phase 1 (Season Canon): flags planted by EARLIER scenes this episode, fed
    // to LATER scenes so SceneWriter can author within-episode callback payoffs.
    const episodePlants: EpisodePlant[] = [];
    const encounters: Map<string, EncounterStructure> = new Map();
    const validationExecutionRecords: ValidatorExecutionRecord[] = [];

    // UNIT QUARANTINE (P2, 2026-07-06): an encounter unit that exhausts its
    // in-place ladder no longer aborts the run mid-phase (the bite-me abort
    // discarded 62 minutes of checkpointed work over one encounter). The unit
    // is quarantined, every other scene finishes and checkpoints, and an
    // escalated retry pass runs at the end of the phase. Only if THAT fails
    // does the phase throw — with all sibling units checkpointed, so resume
    // retries just the failed unit. The missing-encounter guard below and the
    // final story contract still refuse to ship a story with a missing unit.
    const quarantinedEncounters: QuarantinedEncounterUnit[] = [];

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
    const relationshipPolicyChanges = normalizeRelationshipPacingStages(blueprint.scenes as never);
    if (relationshipPolicyChanges > 0) {
      context.emit({
        type: 'debug',
        phase: 'content_generation',
        message: `Normalized ${relationshipPolicyChanges} relationship-pacing contract(s) against earned-stage policy`,
      });
    }
    const relationshipPacingReconciled = reconcileRelationshipPacingWithChoiceTypes(blueprint.scenes as never);
    if (relationshipPacingReconciled > 0) {
      context.emit({
        type: 'debug',
        phase: 'content_generation',
        message: `Reconciled ${relationshipPacingReconciled} relationship-pacing contract(s) after content-phase choice taxonomy reassertion`,
      });
    }
    const plannedChoiceTypesByScene = Object.fromEntries(
      blueprint.scenes
        .filter((scene) => scene.choicePoint?.type)
        .map((scene) => [scene.id, scene.choicePoint!.type as string])
    );
    this.deps.plannedChoiceTypesByScene = {
      ...(this.deps.plannedChoiceTypesByScene ?? {}),
      ...plannedChoiceTypesByScene,
    };
    const mergedPublicAftermathScenes = mergeDuplicatePublicAftermathScenes(blueprint);
    if (mergedPublicAftermathScenes > 0) {
      context.emit({
        type: 'debug',
        phase: 'content_generation',
        message: `Merged ${mergedPublicAftermathScenes} duplicate public-aftermath scene(s) before scene prose generation`,
      });
    }
    const plannedConsequenceTiers = plannedConsequenceTiersByScene(brief.seasonPlan);
    const densityEpisodeNumber = episodeNumber ?? brief.episode.number;
    finalizeEpisodeSceneOwnership(blueprint.scenes as never, {
      episodeNumber: densityEpisodeNumber,
      storyCircleRole: brief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === densityEpisodeNumber)?.storyCircleRole,
    });
    const canonicalPlan = blueprint.episodeEventPlan;
    const canonicalGraph = brief.seasonPlan?.scenePlan?.narrativeContractGraph;
    const canonicalProjectionIssues = canonicalPlan && canonicalGraph
      ? reprojectEpisodeEventPlan(canonicalGraph, canonicalPlan, blueprint.scenes, densityEpisodeNumber)
        .map((issue) => issue.message)
      : [];
    const sceneConstruction = applySceneConstructionProfilesToScenes(blueprint.scenes, { episodeNumber: densityEpisodeNumber });
    const sceneConstructionIssues = sceneConstruction.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    const causalRepairDiagnostics = canonicalPlan
      ? []
      : repairCausalCueOwnershipOrder(blueprint.scenes, { episodeNumber: densityEpisodeNumber });
    const legacyOwnershipDiagnostics = canonicalPlan
      ? []
      : attachSceneEventOwnershipProfiles(blueprint.scenes, { episodeNumber: densityEpisodeNumber });
    const canonicalOwnershipIssues = canonicalPlan
      ? validateCanonicalEpisodeBlueprintProjection(canonicalPlan, blueprint.scenes, densityEpisodeNumber)
        .map((issue) => issue.message)
      : [];
    const sceneEventOwnershipIssues = legacyOwnershipDiagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    const causalRepairErrors = causalRepairDiagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    const sceneOwnershipPreflightIssues = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: densityEpisodeNumber,
      storyCircleRole: brief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === densityEpisodeNumber)?.storyCircleRole,
      episodeSpine: brief.seasonPlan?.scenePlan?.episodeSpines?.[densityEpisodeNumber],
      episodeEventPlan: canonicalPlan,
      scenes: blueprint.scenes,
    }).issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    const routeCueIssues = validateBlueprintRouteCueOrder(blueprint);
    const routeCueIssueMessages = routeCueIssues.map((issue) => issue.message);
    if (outputDirectory) {
      await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-construction-report.json`, {
        episodeNumber: densityEpisodeNumber,
        generatedAt: new Date().toISOString(),
        issues: sceneConstructionIssues,
        eventOwnershipIssues: sceneEventOwnershipIssues,
        causalRepairDiagnostics,
        sceneOwnershipPreflightIssues,
        routeCueIssues,
        sceneConstructionApplications: sceneConstruction.applications,
        profiles: blueprint.scenes.map((scene) => scene.sceneConstructionProfile),
        eventOwnershipProfiles: blueprint.scenes.map((scene) => scene.sceneEventOwnership),
      });
    }
    const preProseConstructionIssues = [
      ...sceneConstructionIssues,
      ...canonicalProjectionIssues,
      ...sceneEventOwnershipIssues,
      ...causalRepairErrors,
      ...canonicalOwnershipIssues,
      ...sceneOwnershipPreflightIssues,
      ...routeCueIssueMessages,
    ];
    if (preProseConstructionIssues.length > 0 && isGateEnabled('GATE_SCENE_CONSTRUCTION_PREFLIGHT')) {
      const summary = preProseConstructionIssues.slice(0, 5).join(' | ');
      context.emit({
        type: 'warning',
        phase: 'scenes',
        message: `Scene construction guard blocked content generation for ${preProseConstructionIssues.length} conflict(s): ${summary}`,
        data: { issues: preProseConstructionIssues },
      });
      throw new PipelineError(
        `[SceneConstructionGate] Episode ${densityEpisodeNumber} unsafe scene construction before content generation: ${summary}. Re-run architecture with one primary turn and one owner per route event before SceneWriter/EncounterArchitect.`,
        'episode_architecture',
        {
          agent: 'SceneConstructionGate',
          context: {
            episodeNumber: densityEpisodeNumber,
            issues: preProseConstructionIssues,
          },
          failure: {
            code: 'scene_construction_conflict',
            ownerStage: 'episode_plan',
            retryClass: 'recompile_episode_plan',
            issueCodes: preProseConstructionIssues.map((_, index) => `scene_construction_${index + 1}`),
            repairTarget: 'episode-blueprint',
          },
        },
      );
    }
    const densityRepair = runBoundedDensityRepair(
      blueprint.scenes as never,
      (scenes) => analyzeEpisodeTreatmentDensity(scenes as never, densityEpisodeNumber),
      unsafeTreatmentDensityReports,
    );
    if (densityRepair.changed) {
      context.emit({
        type: 'warning',
        phase: 'scenes',
        message: `Applied one bounded density repair before content generation: moved ${densityRepair.movedContractIds.length} soft pressure lane(s) along the existing route.`,
        data: { movedContractIds: densityRepair.movedContractIds },
      });
    }
    const treatmentDensityReports = densityRepair.after;
    const treatmentDensityByScene = new Map(treatmentDensityReports.map((report) => [report.sceneId, report]));
    const overloadedDensityReports = treatmentDensityReports.filter((report) => report.overloaded);
    const sceneById = new Map(blueprint.scenes.map((scene) => [scene.id, scene]));
    const unsafeDensityReports = unsafeTreatmentDensityReports(treatmentDensityReports)
      .filter((report) => !this.sceneDensityCanExpandWithBeatBudget(report, sceneById.get(report.sceneId)));
    if (outputDirectory) {
      await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-treatment-density-report.json`, {
        episodeNumber: densityEpisodeNumber,
        generatedAt: new Date().toISOString(),
        reports: treatmentDensityReports,
        overloadedScenes: overloadedDensityReports.map((report) => ({
          sceneId: report.sceneId,
          hardUnits: report.hardUnits,
          totalUnits: report.totalUnits,
          threshold: report.threshold,
          overloadReasons: report.overloadReasons,
          recommendedDirective: report.recommendedDirective,
        })),
        unsafeScenes: unsafeDensityReports.map((report) => ({
          sceneId: report.sceneId,
          hardUnits: report.hardUnits,
          totalUnits: report.totalUnits,
          threshold: report.threshold,
          overloadReasons: report.overloadReasons,
          recommendedDirective: report.recommendedDirective,
        })),
      });
    }
    if (unsafeDensityReports.length > 0) {
      const summary = unsafeDensityReports.map(describeTreatmentDensityReport).join(' | ');
      context.emit({
        type: 'warning',
        phase: 'scenes',
        message: `Treatment density guard blocked content generation for ${unsafeDensityReports.length} unsafe scene(s): ${summary}`,
        data: { reports: unsafeDensityReports },
      });
      throw new PipelineError(
        `[TreatmentDensityGate] Episode ${densityEpisodeNumber} unsafe planned-scene treatment density before content generation: ${summary}. Re-run architecture with blueprint rebalance before SceneWriter/EncounterArchitect.`,
        'episode_architecture',
        {
          agent: 'TreatmentDensityGate',
          context: {
            episodeNumber: densityEpisodeNumber,
            unsafeScenes: unsafeDensityReports,
          },
        },
      );
    }
    if (overloadedDensityReports.length > 0) {
      context.emit({
        type: 'warning',
        phase: 'scenes',
        message: `Treatment density guard flagged ${overloadedDensityReports.length} overloaded scene(s): ${
          overloadedDensityReports.map((report) => `${report.sceneId} (${report.overloadReasons.join('; ')})`).join('; ')
        }`,
        data: { reports: overloadedDensityReports },
      });
    }

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
    // Authored-lite ESC collapse: skip LLM planners — obligations were compiled into ESC.
    // Force with STORYRPG_THREAD_TWIST_PLANNING=1 for polish mode.
    {
      const ttEpisode = episodeNumber ?? brief.episode.number;
      const ttSeasonEpisode = brief.seasonPlan?.episodes.find((e) => e.episodeNumber === ttEpisode);
      const authoredLite = isAuthoredLiteEpisode(ttSeasonEpisode);
      const forceThreadTwist = typeof process !== 'undefined' && process.env.STORYRPG_THREAD_TWIST_PLANNING === '1';
      if (authoredLite && !forceThreadTwist) {
        context.emit({
          type: 'debug',
          phase: 'content',
          message: 'thread_twist_skipped_authored_lite: using ESC-compiled obligations',
        });
        this.seedCompiledThreadTwistFromEsc(blueprint, ttEpisode, context, brief);
      } else if (isThreadTwistPlanningEnabled(context.config.generation)) {
      await Promise.all([
        this.memoryContextFor('ThreadPlanner', 'thread-planning', brief, undefined, ['thread-ledger']),
        this.memoryContextFor('TwistArchitect', 'twist-planning', brief, undefined, ['twist-plan']),
      ]);
      const { threadLedger, twistPlan } = await planEpisodeThreadsAndTwist({
        enabled: true,
        threadPlanner: this.deps.getThreadPlanner(),
        twistArchitect: this.deps.getTwistArchitect(),
        episodeBlueprint: blueprint,
        episodeNumber: ttEpisode,
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonStoryCircle: brief.seasonPlan?.storyCircle,
        episodeStoryCircleRole: ttSeasonEpisode?.storyCircleRole,
        priorThreads: openPriorThreads(this.deps.seasonThreadLedger, ttEpisode),
        emitWarning: (message) => context.emit({ type: 'warning', phase: 'content', message }),
      });
      if (threadLedger) mergeIntoSeasonLedger(this.deps.seasonThreadLedger, threadLedger, ttEpisode);
      if (twistPlan) this.deps.episodeTwistPlans.set(ttEpisode, twistPlan);
      if (this.deps.writeAgentOutcome) {
        await Promise.all([
          threadLedger ? this.deps.writeAgentOutcome({
            role: 'ThreadPlanner',
            lifecycle: 'thread-planning',
            storyId: brief.story.title,
            episodeNumber: ttEpisode,
            artifactKinds: ['thread-ledger'],
            outcome: 'adopted',
            summary: 'Thread ledger adopted for episode scene authoring.',
            payload: threadLedger,
          }) : Promise.resolve(),
          twistPlan ? this.deps.writeAgentOutcome({
            role: 'TwistArchitect',
            lifecycle: 'twist-planning',
            storyId: brief.story.title,
            episodeNumber: ttEpisode,
            artifactKinds: ['twist-plan'],
            outcome: 'adopted',
            summary: 'Twist plan adopted for episode scene authoring.',
            payload: twistPlan,
          }) : Promise.resolve(),
        ]);
      }
      if (outputDirectory && (threadLedger || twistPlan)) {
        await saveEarlyDiagnostic(outputDirectory, `episode-${ttEpisode}-thread-twist-plan.json`, {
          generatedAt: new Date().toISOString(),
          threadLedger,
          twistPlan,
          seasonThreadCount: this.deps.seasonThreadLedger.threads.length,
        }).catch(() => undefined);
      }
      }
    }

    // Character-arc tracking (WS0 wiring): author this episode's identity/
    // relationship targets after the blueprint is final, before scene prose.
    // All logic lives in characterArcPlanning (monolith ratchet). Default-off;
    // the agent fails open.
    // Authored-lite: skip LLM — arc pressure compiled into ESC polarity/obligations.
    {
      const atEpisode = episodeNumber ?? brief.episode.number;
      const atSeasonEpisode = brief.seasonPlan?.episodes.find((e) => e.episodeNumber === atEpisode);
      const authoredLite = isAuthoredLiteEpisode(atSeasonEpisode);
      const forceArc = typeof process !== 'undefined' && process.env.STORYRPG_CHARACTER_ARC_TRACKING === '1';
      if (authoredLite && !forceArc) {
        context.emit({
          type: 'debug',
          phase: 'content',
          message: 'character_arc_skipped_authored_lite: using ESC polarity / arcPressureContracts',
        });
        this.seedCompiledArcTargetsFromPlan(brief, atEpisode, blueprint);
      } else if (isCharacterArcTrackingEnabled(context.config.generation)) {
      await this.memoryContextFor('CharacterArcTracker', 'character-arc-planning', brief, undefined, ['character-arc-targets']);
      const { arcTargets } = await planEpisodeArcTargets({
        enabled: true,
        characterArcTracker: this.deps.getCharacterArcTracker(),
        episodeBlueprint: blueprint,
        characterBible,
        seasonArcPlan: brief.seasonPlan,
        episodeIndex: atEpisode,
        totalEpisodes: brief.seasonPlan?.episodes?.length ?? atEpisode,
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonStoryCircle: brief.seasonPlan?.storyCircle,
        episodeStoryCircleRole: atSeasonEpisode?.storyCircleRole,
        characterArchitecture: brief.multiEpisode?.sourceAnalysis?.characterArchitecture,
        emitWarning: (message) => context.emit({ type: 'warning', phase: 'content', message }),
      });
      if (arcTargets) {
        this.deps.episodeArcTargets.set(atEpisode, arcTargets);
        if (this.deps.writeAgentOutcome) {
          await this.deps.writeAgentOutcome({
            role: 'CharacterArcTracker',
            lifecycle: 'character-arc-planning',
            storyId: brief.story.title,
            episodeNumber: atEpisode,
            artifactKinds: ['character-arc-targets'],
            outcome: 'adopted',
            summary: 'Character arc targets adopted for episode scene authoring.',
            payload: arcTargets,
          });
        }
        if (outputDirectory) {
          await saveEarlyDiagnostic(outputDirectory, `episode-${atEpisode}-arc-targets.json`, {
            generatedAt: new Date().toISOString(),
            arcTargets,
          }).catch(() => undefined);
        }
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
      // R2 (realized-context threading): the narrative predecessor comes from
      // the scene GRAPH, not generation order — `sceneContents[i-1]` is a
      // branch SIBLING for branch scenes, and its keyMoments are plan labels.
      // The realized summary hands the writer what was actually written
      // (closing prose + location/time anchors). Generation-order fallback
      // only when the graph yields nothing (e.g. opening scene: undefined).
      const graphPredecessor = resolveGraphPredecessor(
        blueprint.scenes,
        sceneBlueprint.id,
        (sceneId) => sceneContents.find((sc) => sc.sceneId === sceneId),
      );
      const previousScene = graphPredecessor?.content
        ?? (i > 0 ? sceneContents[i - 1] : undefined);
      const previousSceneSummary = previousScene
        ? buildRealizedSceneSummary(
            previousScene,
            graphPredecessor?.blueprint
              ?? blueprint.scenes.find((scene) => scene.id === previousScene.sceneId),
          )
        : undefined;
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

      const canHydrateResume = outputDirectory && episodeNumber
        && (this.deps.canLoadResumeUnit?.(episodeNumber, sceneUnitId) ?? true);
      if (canHydrateResume) {
        const resumedScene = this.deps.loadResumeUnit<SceneContent>(outputDirectory, sceneUnitId, sceneCheckpointPath);
        const resumedChoice = sceneBlueprint.choicePoint
          ? this.deps.loadResumeUnit<ChoiceSet>(outputDirectory, choiceUnitId, choiceCheckpointPath)
          : undefined;
        const resumedEncounter = sceneBlueprint.isEncounter && sceneBlueprint.encounterType
          ? this.deps.loadResumeUnit<EncounterStructure>(outputDirectory, encounterUnitId, encounterCheckpointPath)
          : undefined;
        const resumedEncounterTurn = resumedEncounter
          ? assessEncounterTurnRealization(sceneBlueprint, resumedEncounter)
          : undefined;
        if (resumedEncounter && resumedEncounterTurn && !resumedEncounterTurn.passed) {
          context.emit({
            type: 'warning',
            phase: 'encounters',
            message: `Discarding resumed encounter checkpoint for ${sceneBlueprint.id}: authored encounter turn is under-realized. ${formatEncounterTurnRealizationFeedback(resumedEncounterTurn)}`,
          });
        }
        // A resumed encounter carrying template/fallback prose was checkpointed
        // before the producing bug was fixed — regenerate it now instead of
        // replaying boilerplate into the episode (it would only fail later).
        const resumedEncounterBoilerplate = resumedEncounter
          ? scanEncounterBoilerplate(resumedEncounter, sceneBlueprint)
          : [];
        if (resumedEncounter && resumedEncounterBoilerplate.length > 0) {
          context.emit({
            type: 'warning',
            phase: 'encounters',
            message: `Discarding resumed encounter checkpoint for ${sceneBlueprint.id}: carries ${resumedEncounterBoilerplate.length} template/fallback prose signature(s) (${resumedEncounterBoilerplate.slice(0, 3).map((hit) => hit.label).join(', ')}).`,
          });
        }
        const resumedChoiceBlockers = resumedChoice
          ? (await this.validateNarrativeRealization({
              sceneId: sceneBlueprint.id,
              tasks: sceneBlueprint.realizationTasks,
              sceneContent: resumedScene,
              choiceSet: resumedChoice,
              mode: 'owner',
              currentStage: 'choice_author',
              candidateHash: stableHash(resumedChoice),
            })).findings.filter((finding) => finding.blocking)
          : [];
        const resumedEncounterBlockers = resumedEncounter
          ? (await this.validateNarrativeRealization({
              sceneId: sceneBlueprint.id,
              tasks: sceneBlueprint.realizationTasks,
              sceneContent: resumedScene,
              choiceSet: resumedChoice,
              encounter: resumedEncounter,
              mode: 'owner',
              currentStage: 'encounter_architect',
              candidateHash: stableHash(resumedEncounter),
            })).findings.filter((finding) => finding.blocking)
          : [];
        if (resumedChoiceBlockers.length > 0 || resumedEncounterBlockers.length > 0) {
          context.emit({
            type: 'warning',
            phase: 'content',
            message: `Discarding resumed content checkpoint for ${sceneBlueprint.id}: ${resumedChoiceBlockers.length + resumedEncounterBlockers.length} canonical owner-stage realization task(s) remain unresolved.`,
            data: { findings: [...resumedChoiceBlockers, ...resumedEncounterBlockers] },
          });
        }
        const hasRequiredChoice = !sceneBlueprint.choicePoint
          || Boolean(resumedChoice && resumedChoiceBlockers.length === 0);
        const hasRequiredEncounter = !(sceneBlueprint.isEncounter && sceneBlueprint.encounterType)
          || Boolean(
            resumedEncounter
            && resumedEncounterTurn?.passed
            && resumedEncounterBoilerplate.length === 0
            && resumedEncounterBlockers.length === 0,
          );
        if (resumedScene && hasRequiredChoice && hasRequiredEncounter) {
          if (sceneBlueprint.isEncounter && sceneBlueprint.encounterType) {
            this.ensureEncounterBridgeBeat(sceneBlueprint, resumedScene);
          }
          sceneContents.push(resumedScene);
          if (resumedChoice) choiceSets.push(resumedChoice);
          if (resumedEncounter) encounters.set(sceneBlueprint.id, resumedEncounter);
          if (resumedEncounter && this.deps.incrementalValidator) {
            const conditionIssues = this.deps.incrementalValidator.checkEncounterChoiceConditions(resumedEncounter);
            if (conditionIssues.length > 0) {
              context.emit({
                type: 'warning',
                phase: 'encounter',
                message: `Resumed encounter ${sceneBlueprint.id}: ${conditionIssues.length} flag chronology issue(s) — ${conditionIssues.map(issue => issue.detail).join('; ')}`,
              });
            }
            this.deps.trackEncounterFlagConsequences(resumedEncounter);
          }
          await this.recordResumedSceneValidation({
            sceneBlueprint,
            sceneContent: resumedScene,
            choiceSet: resumedChoice,
            encounter: resumedEncounter,
            characterBible,
            episodeNumber: episodeNumber ?? brief.episode.number,
            encounterValidationEnabled: Boolean(incrementalConfig.encounterValidation),
            context,
          });
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
      const protagonistProfile = resolveCharacterProfile(characterBible.characters, brief.protagonist.id)
        ?? resolveCharacterProfile(characterBible.characters, brief.protagonist.name);
      if (sceneBlueprint.npcsPresent) {
        const canonicalNpcIds = new Map<string, string>();
        for (const npcRef of sceneBlueprint.npcsPresent) {
          const profile = resolveCharacterProfile(characterBible.characters, npcRef);
          const canonicalId = profile?.id ?? npcRef;
          const normalizedRef = String(npcRef).toLowerCase().replace(/^(?:char|character|npc)[-_:]/, '').replace(/[^a-z0-9]+/g, ' ').trim();
          const normalizedProtagonist = brief.protagonist.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (profile?.id === protagonistProfile?.id || normalizedRef === normalizedProtagonist) continue;
          canonicalNpcIds.set(canonicalId, canonicalId);
        }
        sceneBlueprint.npcsPresent = [...canonicalNpcIds.values()];
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
        
        // No scaffold beat: the encounter's own phase beats are the scene's
        // reader-facing prose (gameStore falls back to the first encounter
        // beat when a scene has no beats). A fabricated bridge beat pasted
        // treatment text as player prose — bite-me 2026-07-03 shipped
        // "The moment arrives before you can prepare for it: <treatment>".
        const encounterSceneContent: SceneContent = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          locationId: sceneSettingContext.locationId,
          beats: [],
          startingBeatId: '',
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
        // Staging is derived from the ACTUAL generated content of earlier scenes
        // — `charactersInvolved` metadata PLUS roster names found in the prose
        // itself — not the planned blueprint cast. Season plans can blanket-cast
        // NPCs onto scenes whose prose never stages them (storyrpg-lite
        // 2026-07-04T21-46-05: Stela "staged" in s1-1 by cast while the s1-1
        // prose contained only the protagonist), and the LLM cast metadata can
        // omit an NPC the prose plainly names (2026-07-04T23-09-35: s1-2's
        // prose introduced Stela while its charactersInvolved listed only the
        // protagonist). Prose is ground truth; metadata is a supplement.
        const rosterNpcs = characterBible.characters
          .filter((c) => c.id !== brief.protagonist.id)
          .map((c) => ({ id: c.id, name: c.name }));
        const introducedBeforeScene = introducedNpcIds({
          episodeNumber: brief.episode.number,
          rosterNpcIds: rosterNpcs.map((c) => c.id),
          characterIntroductions: brief.seasonPlan?.characterIntroductions,
          alreadyStagedNpcIds: sceneContents.flatMap((content) => [
            ...(content.charactersInvolved || []),
            ...npcIdsNamedInProse(
              (content.beats || [])
                .flatMap((beat) => [
                  beat.text,
                  (beat as { setupText?: string }).setupText,
                  (beat as { escalationText?: string }).escalationText,
                  ...((beat as { textVariants?: Array<{ text?: string }> }).textVariants || []).map((v) => v.text),
                ])
                .filter(Boolean)
                .join(' '),
              rosterNpcs,
            ),
          ]),
        });
        this.pruneUnscopedTreatmentSeedBeats(sceneBlueprint);
        const sceneRealizationBlueprint = buildSceneConstructionPromptView(sceneBlueprint);
        const densityReport = treatmentDensityByScene.get(sceneBlueprint.id);
        const densityGuidance = densityReport?.overloaded
          ? [
              'TREATMENT DENSITY GUARD:',
              `This scene is overloaded (${densityReport.overloadReasons.join('; ')}).`,
              'Do not add recap, timeline jumps, or extra treatment beats beyond the assigned scene turn.',
              'Prioritize the scene\'s central visible action, preserve chronological order, and leave outside-scope obligations for neighboring scenes or later repair routing.',
            ].join(' ')
          : '';

        const sceneWriterInput = {
          sceneBlueprint: sceneRealizationBlueprint,
          storyContext: {
            title: brief.story.title,
            genre: brief.story.genre,
            tone: brief.story.tone,
            userPrompt: [brief.userPrompt, densityGuidance].filter(Boolean).join('\n\n'),
            worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
          },
          protagonistInfo: {
            name: brief.protagonist.name,
            pronouns: brief.protagonist.pronouns,
            description: protagonistProfile?.fullBackground || brief.protagonist.description,
            physicalDescription: protagonistProfile?.physicalDescription,
          },
          npcs: sceneRealizationBlueprint.npcsPresent.map(npcId => {
            const profile = resolveCharacterProfile(characterBible.characters, npcId);
            // Prevention: append the capability constraint so the writer never
            // depicts a non-combatant fighting (Season Canon, Phase B).
            const capabilityNote = profile ? capabilityNoteForProfile(profile) : '';
            // Prevention: append hard presence constraints so the writer never
            // stages a daylight-bound character in the afternoon (bite-me
            // 2026-07-03: vampiric ally on a daytime house call).
            const availabilityNote = profile?.timeOfDayConstraints?.unavailable?.length
              ? `HARD CONSTRAINT: ${profile.name} can NEVER appear during ${profile.timeOfDayConstraints.unavailable.join(', ')}${profile.timeOfDayConstraints.reason ? ` (${profile.timeOfDayConstraints.reason})` : ''}. If this scene's time of day conflicts, keep them off-page (text, call, note) or shift the scene's clock in prose.`
              : '';
            return {
              id: npcId,
              name: profile?.name || npcId,
              pronouns: profile?.pronouns || 'they/them',
              description: [profile?.overview || '', capabilityNote, availabilityNote].filter(Boolean).join(' '),
              physicalDescription: profile?.physicalDescription,
              voiceNotes: profile?.voiceProfile?.writingGuidance || '',
              currentMood: profile?.voiceProfile?.whenNervous,
              isFirstOnPageAppearance: !isIntroducedNpc(introducedBeforeScene, npcId),
            };
          }),
          // Roster characters the reader hasn't met and who aren't in this scene's
          // cast — the writer must not name them (the "who is this?" defect class).
          notYetIntroducedNames: forbiddenNpcNames({
            roster: rosterNpcs,
            introduced: introducedBeforeScene,
            sceneCastIds: sceneRealizationBlueprint.npcsPresent,
          }),
          // Diegetic timeline handoff: GRAPH predecessor's time/place + whether this
          // scene's planned time/location differ (transition acknowledgment required).
          sceneTimeline: buildRealizedTimelineHandoff(
            blueprint.scenes || [],
            sceneRealizationBlueprint,
            graphPredecessor?.blueprint,
          ),
          relevantFlags: blueprint.suggestedFlags,
          relevantScores: blueprint.suggestedScores,
          premiseContracts: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.premiseContracts ?? [])
            .filter((contract) => contract.targetSceneIds.includes(sceneBlueprint.id) || (!contract.targetSceneIds.length && contract.episodeNumber === brief.episode.number))
            .map((contract) => ({ id: contract.id, fieldName: contract.fieldName, sourceText: contract.sourceText, evidencePatterns: contract.evidencePatterns, blocking: contract.blocking })),
          // Step 2 (info-ledger): resolve the INFO ids assigned to this scene to their
          // authored fact text so SceneWriter plants/reveals/pays off each phase on-page.
          setupDirectives: (sceneRealizationBlueprint.setsUpInfoIds ?? [])
            .map((infoId) => {
              const entry = brief.seasonPlan?.informationLedger?.find((e) => e.id === infoId);
              const touch = entry?.setupTouchDetails?.find((detail) => detail.episodeNumber === (brief.episode?.number ?? 1));
              const fact = touch?.requiredSurface || entry?.label || entry?.description;
              return fact ? { infoId, fact } : undefined;
            })
            .filter((d): d is { infoId: string; fact: string } => Boolean(d)),
          revealDirectives: (sceneRealizationBlueprint.revealsInfoIds ?? [])
            .map((infoId) => {
              const entry = brief.seasonPlan?.informationLedger?.find((e) => e.id === infoId);
              const fact = entry?.factualAtoms?.filter((atom) => atom.phase === 'reveal').map((atom) => atom.text).join('; ')
                || entry?.label
                || entry?.description;
              return fact ? { infoId, fact } : undefined;
            })
            .filter((d): d is { infoId: string; fact: string } => Boolean(d)),
          payoffDirectives: (sceneRealizationBlueprint.paysOffInfoIds ?? [])
            .map((infoId) => {
              const entry = brief.seasonPlan?.informationLedger?.find((e) => e.id === infoId);
              const fact = entry?.factualAtoms?.filter((atom) => atom.phase === 'payoff').map((atom) => atom.text).join('; ')
                || entry?.payoffPlan
                || entry?.label
                || entry?.description;
              return fact ? { infoId, fact } : undefined;
            })
            .filter((d): d is { infoId: string; fact: string } => Boolean(d)),
          // G12 (forbidden reveals): the inverse of revealDirectives — ledger facts
          // still withheld at this episode, so the writer cannot burn a season secret
          // early (Carmen unmasked in ep2, the staged rescue confirmed in ep2, …).
          forbiddenReveals: buildForbiddenReveals(
            brief.seasonPlan?.informationLedger,
            brief.episode?.number ?? 1,
            [...(sceneRealizationBlueprint.revealsInfoIds ?? []), ...(sceneRealizationBlueprint.paysOffInfoIds ?? [])],
          ),
          // B1 (Season Canon read-back): serve the sealed canon as authoritative
          // "do not contradict" context so prior-episode facts constrain this prose.
          establishedCanon: this.deps.establishedCanonForPrompt(brief.episode?.number),
          unresolvedCallbacks: mergeUnresolvedForScene(this.deps.getUnresolvedCallbacksForPrompt(brief.episode?.number), episodePlants, brief.episode?.number ?? 1),
          targetBeatCount: this.deps.getTargetBeatCountForScene(sceneRealizationBlueprint),
          dialogueHeavy: sceneRealizationBlueprint.npcsPresent.length > 0,
          previousSceneSummary,
          nextSceneContext,
          incomingChoiceContext: sceneRealizationBlueprint.incomingChoiceContext,
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
          continueInLocation: buildContinueInLocation(blueprint, sceneRealizationBlueprint),
          sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
          episodeEncounterContext: primaryEncounterContext && !sceneBlueprint.isEncounter
            ? {
                ...primaryEncounterContext,
                encounterBuildup: sceneRealizationBlueprint.encounterBuildup || 'Foreshadow the encounter stakes without depicting or resolving the encounter event itself.',
              }
            : undefined,
          memoryContext: await this.memoryContextFor('SceneWriter', 'scene-authoring', brief, sceneRealizationBlueprint, ['episode-blueprint']),
          branchContext: branchContextByScene.get(sceneBlueprint.id),
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonStoryCircle: brief.seasonPlan?.storyCircle,
          episodeStoryCircleRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.storyCircleRole,
          episodeCircle: blueprint.episodeCircle,
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
        const {
          input: sceneWriterInputForAuthoring,
          diagnostics: sceneWriterCompaction,
        } = compactSceneWriterInput(sceneWriterInput);
        const droppedContractCount = Object.values(sceneWriterCompaction.droppedCounts)
          .reduce((sum, value) => sum + value, 0);
        if (droppedContractCount > 0 || sceneWriterCompaction.compactSceneBytes < sceneWriterCompaction.originalSceneBytes) {
          context.emit({
            type: 'debug',
            phase: 'scenes',
            message: `SceneWriter input compacted for ${sceneBlueprint.id}: ${sceneWriterCompaction.originalSceneBytes} -> ${sceneWriterCompaction.compactSceneBytes} bytes`,
            data: sceneWriterCompaction,
          });
        }
        // R3 (contract-budget honesty): compaction must not SILENTLY drop a
        // contract the season-final validators still enforce — the writer
        // never sees the obligation, so the run is guaranteed to fail 24+
        // minutes later. Blocking drops surface HERE, pre-prose, as the same
        // plan-overload class the TreatmentDensityGate throws (blueprint
        // rebalance), behind the existing plan-preflight gate. Non-blocking
        // (advisory) drops are logged with the exact contracts dropped.
        const droppedBlocking = droppedBlockingContracts(sceneWriterCompaction);
        if (droppedContractCount > 0) {
          const droppedAdvisory = sceneWriterCompaction.droppedContracts.filter((contract) => !contract.blocking);
          if (droppedAdvisory.length > 0) {
            context.emit({
              type: 'warning',
              phase: 'scenes',
              message: `SceneWriter compaction dropped ${droppedAdvisory.length} advisory contract(s) for ${sceneBlueprint.id}: ${
                droppedAdvisory.map((contract) => `${contract.family}:${contract.id || contract.label}`).join('; ')
              }`,
              data: { droppedContracts: droppedAdvisory },
            });
          }
        }
        if (droppedBlocking.length > 0 && isGateEnabled('GATE_SCENE_CONSTRUCTION_PREFLIGHT')) {
          const summary = droppedBlocking
            .map((contract) => `${contract.family}:${contract.id || contract.label}`)
            .join('; ');
          context.emit({
            type: 'warning',
            phase: 'scenes',
            message: `Contract budget guard blocked scene ${sceneBlueprint.id}: compaction would drop ${droppedBlocking.length} blocking contract(s) the final contract still enforces (${summary})`,
            data: { droppedBlocking, compaction: sceneWriterCompaction },
          });
          if (outputDirectory) {
            await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-contract-budget-overflow.json`, {
              episodeNumber: densityEpisodeNumber,
              sceneId: sceneBlueprint.id,
              generatedAt: new Date().toISOString(),
              droppedBlocking,
              droppedContracts: sceneWriterCompaction.droppedContracts,
              originalCounts: sceneWriterCompaction.originalCounts,
              compactCounts: sceneWriterCompaction.compactCounts,
            });
          }
          throw new PipelineError(
            `[TreatmentDensityGate] Scene ${sceneBlueprint.id} carries more blocking contracts than the SceneWriter prompt budget: compaction would drop ${droppedBlocking.length} blocking contract(s) (${summary}). Re-run architecture with blueprint rebalance so every enforced obligation fits the scene's budget before SceneWriter runs.`,
            'episode_architecture',
            {
              agent: 'TreatmentDensityGate',
              context: {
                episodeNumber: densityEpisodeNumber,
                sceneId: sceneBlueprint.id,
                droppedBlocking,
              },
            },
          );
        }

        // R8 (authoring economics): a scene whose blueprint is mostly enforced
        // obligations authors at a lower temperature — precision over flourish.
        // Config-driven; without an explicit threshold the tuning applies only
        // on treatment-sourced runs (where heavy contract loads occur). The
        // switch covers every SceneWriter call in this scene's iteration
        // (first draft, best-of-N, retries, regens) and resets per scene.
        {
          const generation = context.config.generation;
          const thresholdConfigured = generation?.heavyContractSceneBlockThreshold != null;
          const heavyThreshold = generation?.heavyContractSceneBlockThreshold ?? 12;
          const heavyTemperature = generation?.heavyContractSceneTemperature ?? 0.65;
          const contractBlocks = totalContractBlocks(sceneWriterCompaction);
          const treatmentSourced = Boolean(brief.multiEpisode?.sourceAnalysis);
          const isHeavy = (thresholdConfigured || treatmentSourced) && contractBlocks >= heavyThreshold;
          this.deps.sceneWriter.setContractLoadTemperature(isHeavy ? heavyTemperature : undefined);
          if (isHeavy) {
            context.emit({
              type: 'debug',
              phase: 'scenes',
              message: `Scene ${sceneBlueprint.id} carries ${contractBlocks} contract block(s) (>=${heavyThreshold}) — authoring at temperature ${heavyTemperature}`,
            });
          }
        }

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

          const candidates: Array<AgentResponse<SceneContent> | {
            success: false;
            data: SceneContent | null;
            error: string;
          }> = [];
          for (let idx = 0; idx < bestOfN; idx += 1) {
            const candidate = await withTimeout(
              this.deps.sceneWriter.execute(sceneWriterInputForAuthoring),
              PIPELINE_TIMEOUTS.llmAgent,
              `SceneWriter.execute(${sceneBlueprint.id} candidate-${idx})`
            ).catch((err) => ({
              success: false as const,
              data: null as SceneContent | null,
              error: err instanceof Error ? err.message : String(err),
            }));
            candidates.push(candidate);
          }

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
            this.deps.sceneWriter.execute(sceneWriterInputForAuthoring),
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
          const shouldCompactRetry = isSceneWriterCompactRetryReason(sceneFailureReason);
          const compactRetryInstruction = shouldCompactRetry
            ? '\n\nCOMPACT RETRY MODE: The previous response was too large to safely process. Return one complete SceneContent JSON object under the hard raw-response budget. Use 6-8 beats, concise prose, compact visual metadata, no optional boilerplate arrays/fields, and textVariants only when they have a real condition from the prompt.'
            : '';

          const retrySceneWriterInput = {
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
            targetBeatCount: shouldCompactRetry
              ? Math.min(this.deps.getTargetBeatCountForScene(sceneBlueprint), 8)
              : this.deps.getTargetBeatCountForScene(sceneBlueprint),
            dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
            previousSceneSummary,
            nextSceneContext,
            incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
            sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
            memoryContext: await this.memoryContextFor('SceneWriter', 'scene-retry', brief, sceneBlueprint, ['episode-blueprint']),
          };
          const {
            input: retrySceneWriterInputForAuthoring,
            diagnostics: retryCompaction,
          } = compactSceneWriterInput(retrySceneWriterInput);
          if (shouldCompactRetry) {
            context.emit({
              type: 'debug',
              phase: 'scenes',
              message: `SceneWriter compact retry for ${sceneBlueprint.id}: ${retryCompaction.originalSceneBytes} -> ${retryCompaction.compactSceneBytes} bytes`,
              data: retryCompaction,
            });
          }

          const retrySceneResult = await withTimeout(
            this.deps.sceneWriter.execute(retrySceneWriterInputForAuthoring),
            PIPELINE_TIMEOUTS.llmAgent,
            `SceneWriter.execute(${sceneBlueprint.id} retry)`,
          );

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
        sceneContent.requiredBeats = sceneRealizationBlueprint.requiredBeats;
        sceneContent.signatureMoment = sceneRealizationBlueprint.signatureMoment;
        const infoMarkersAdded = emitSceneInfoMarkersOnBeats(sceneBlueprint, sceneContent.beats);
        if (infoMarkersAdded > 0) {
          context.emit({
            type: 'debug',
            phase: 'scenes',
            message: `Planted ${infoMarkersAdded} deterministic information-ledger marker(s) on ${sceneBlueprint.id}.`,
          });
        }

        // Scene-time narration-tense check (GATE_SCENE_TENSE_CHECK): the
        // story's narration convention is present tense. A scene written
        // wholesale in past tense costs ONE SceneWriter retry here; the same
        // drift at the final contract costs repair rounds or the run (bite-me
        // 2026-07-05T20-47-31: s1-2). Runs before the realization check so a
        // full-scene rewrite cannot drop realization patches applied later.
        if (isGateEnabled('GATE_SCENE_TENSE_CHECK')) {
          // Per-beat detection is shared with the final contract
          // (NarrativeFailureModeValidator via detectBeatTenseDrift) so any
          // beat that would block there is caught here first, where it costs
          // one SceneWriter retry instead of final-contract repair rounds
          // (R7 — one detector per defect class). The scene-wide census stays
          // as a secondary trigger for scenes drifted in aggregate below the
          // per-beat blocking threshold.
          const tenseCensus = sceneTenseCensus(sceneContent.beats);
          const beatDrifts = detectBeatTenseDrift(sceneContent.beats);
          if (beatDrifts.length > 0 || isSceneWideTenseDrift(tenseCensus)) {
            const driftedBeatIds = beatDrifts.length > 0
              ? beatDrifts.map((drift) => drift.beatId ?? '')
              : tenseCensus.driftedBeatIds;
            context.emit({
              type: 'regeneration_triggered',
              phase: 'scenes',
              message: `Scene ${sceneBlueprint.id} narrates live action in past tense (${beatDrifts.length} blocking beat(s); ${tenseCensus.driftedBeats}/${tenseCensus.eligibleBeats} narration beats drifted) — retrying with tense feedback`,
              data: { driftedBeatIds },
            });
            const tenseRetry = await withTimeout(
              this.deps.sceneWriter.execute({
                ...sceneWriterInput,
                storyContext: {
                  ...sceneWriterInput.storyContext,
                  userPrompt: `${sceneWriterInput.storyContext.userPrompt || ''}\n\nTENSE FEEDBACK: Your previous draft narrated live scene action in PAST tense (${tenseCensus.driftedBeats} of ${tenseCensus.eligibleBeats} narration beats). This story is narrated in PRESENT tense. Rewrite the scene with all live on-page action in present tense; use past tense ONLY inside dialogue or for explicit memories, backstory, or recaps.`,
                },
              }),
              PIPELINE_TIMEOUTS.llmAgent,
              `SceneWriter.execute(${sceneBlueprint.id} tense-retry)`,
            ).catch((err) => ({
              success: false as const,
              data: null as SceneContent | null,
              error: err instanceof Error ? err.message : String(err),
            }));
            if (tenseRetry.success && tenseRetry.data) {
              const retryBeatDrifts = detectBeatTenseDrift(tenseRetry.data.beats ?? []);
              const retryCensus = sceneTenseCensus(tenseRetry.data.beats ?? []);
              const improved = retryBeatDrifts.length < beatDrifts.length
                || (retryBeatDrifts.length === beatDrifts.length && retryCensus.driftedBeats < tenseCensus.driftedBeats);
              if (improved) {
                Object.assign(sceneContent, tenseRetry.data);
                sceneContent.sceneId = sceneBlueprint.id;
                sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
                sceneContent.locationId = sceneSettingContext.locationId;
                sceneContent.settingContext = sceneSettingContext;
                sceneContent.requiredBeats = sceneRealizationBlueprint.requiredBeats;
                sceneContent.signatureMoment = sceneRealizationBlueprint.signatureMoment;
                context.emit({
                  type: 'debug',
                  phase: 'scenes',
                  message: `Tense retry for ${sceneBlueprint.id} adopted: blocking beats ${beatDrifts.length} -> ${retryBeatDrifts.length}; drifted narration beats ${tenseCensus.driftedBeats} -> ${retryCensus.driftedBeats}`,
                });
              }
            }
            const residualBeatDrifts = detectBeatTenseDrift(sceneContent.beats);
            const residualCensus = sceneTenseCensus(sceneContent.beats);
            if (residualBeatDrifts.length > 0 || isSceneWideTenseDrift(residualCensus)) {
              context.emit({
                type: 'warning',
                phase: 'scenes',
                message: `Scene ${sceneBlueprint.id} still narrates in past tense after tense retry (${residualBeatDrifts.length} blocking beat(s); ${residualCensus.driftedBeats}/${residualCensus.eligibleBeats} beats) — deferring to the final-contract tense repair route.`,
                data: { driftedBeatIds: residualBeatDrifts.length > 0 ? residualBeatDrifts.map((drift) => drift.beatId ?? '') : residualCensus.driftedBeatIds },
              });
            }
          }
        }

        // Scene-time realization check (GATE_SCENE_REQUIRED_BEAT_CHECK):
        // verify the freshly written prose depicts every authored
        // requiredBeat/signatureMoment using the same scoring the season-final
        // validators apply (deterministic, no LLM). An under-realized scene
        // gets a tiny bounded SceneWriter retry loop whose feedback names the
        // exact missing content words — a retry here costs one scene; the same
        // miss at the final contract costs the whole run (bite-me-g13).
        const canonicalSceneWriterTasks = (sceneBlueprint.realizationTasks ?? [])
          .filter((task) => task.ownerStage === 'scene_writer');
        const hasCanonicalEventTask = canonicalSceneWriterTasks.some((task) => Boolean(task.canonicalEventId));
        if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK') && !hasCanonicalEventTask) {
          let missing = missingRequiredMoments(sceneRealizationBlueprint, sceneContent.beats);
          if (missing.length > 0) {
            // R8: an under-realized first draft is a SceneCritic candidate
            // for the flag-gated pass.
            flagSceneForCritic(sceneContent, 'realization-retry');
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
                const retryMissing = missingRequiredMoments(sceneRealizationBlueprint, realizationRetry.data.beats);
                if (improvesMissingRealization(missing, retryMissing)) {
                  // Retry realized more of the contract — adopt it in place
                  // (sceneContent stays the canonical object the rest of the
                  // loop and the push use; re-apply the normalization).
                  Object.assign(sceneContent, realizationRetry.data);
                  sceneContent.sceneId = sceneBlueprint.id;
                  sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
                  sceneContent.locationId = sceneSettingContext.locationId;
                  sceneContent.settingContext = sceneSettingContext;
                  sceneContent.requiredBeats = sceneRealizationBlueprint.requiredBeats;
                  sceneContent.signatureMoment = sceneRealizationBlueprint.signatureMoment;
                  missing = retryMissing;
                }
                context.emit({
                  type: 'debug',
                  phase: 'scenes',
                  message: `Realization retry ${attempt}/2 for ${sceneBlueprint.id}: ${missing.length} under-realized moment(s) remain`,
                });
              }
              // Moments the guard refuses to insert BECAUSE they are summary
              // text (story-circle contracts, design-note prose) are not
              // scene-fail material: their prose realization is judged
              // semantically at season-final (judge+regen), where token
              // heuristics don't force literal summary words into fiction.
              const deferredSummaryMoments = new Set<string>();
              if (missing.length > 0) {
                const currentProse = sceneContent.beats.map((beat) => beat.text ?? '').join('\n');
                for (const moment of missing) {
                  if (isNonStageableRequiredMomentSource(moment, currentProse)) {
                    deferredSummaryMoments.add(moment.moment);
                  }
                }
                context.emit({
                  type: 'warning',
                  phase: 'scenes',
                  message: `Scene ${sceneBlueprint.id} left ${missing.length} authored moment(s) for LLM-owned final realization repair; deterministic prose insertion is disabled.`,
                  data: { deferred: missing.map((moment) => ({ tier: moment.tier, moment: moment.moment })) },
                });
              }
              const hardMissing = missing.filter((m) => !deferredSummaryMoments.has(m.moment));
              if (missing.length > hardMissing.length) {
                context.emit({
                  type: 'warning',
                  phase: 'scenes',
                  message: `Scene ${sceneBlueprint.id} defers ${missing.length - hardMissing.length} summary-shaped authored moment(s) to the season-final realization gate (never inserted as prose).`,
                });
              }
              if (hardMissing.length > 0) {
                const unresolved = hardMissing
                  .map((m) => `[${m.tier}] ${m.moment}`)
                  .join('; ');
                if (isGateEnabled('GATE_SCENE_REALIZATION_ABORT')) {
                  throw new Error(
                    `Scene ${sceneBlueprint.id} still under-realizes authored moment(s) after realization retry: ${unresolved}`,
                  );
                }
                // Two-tier policy: an under-realized scene after the bounded
                // retry is a quality finding, not a run-safety blocker. The
                // contract (sceneContent.requiredBeats) travels with the
                // content, so the season-final realization gate re-detects the
                // same miss and routes a bounded judge+regen repair there —
                // degrading here keeps 25 minutes of prior work instead of
                // discarding the run.
                context.emit({
                  type: 'warning',
                  phase: 'scenes',
                  message:
                    `Scene ${sceneBlueprint.id} still under-realizes ${hardMissing.length} authored moment(s) after realization retry — ` +
                    `deferring to the season-final realization gate: ${unresolved}`,
                  data: { missing: hardMissing.map((m) => ({ tier: m.tier, moment: m.moment, missingTokens: m.missingTokens })) },
                });
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

        // Owner-stage realization gate: canonical evidence tasks are actionable
        // scene contracts, not final-only diagnostics. Give SceneWriter a bounded
        // repair opportunity before choices, media, or checkpointing can amplify
        // an under-realized opening/event/relationship surface.
        if (canonicalSceneWriterTasks.length > 0) {
          const ownerRepairHistory: Array<{
            attempt: number;
            authoredAttempt?: number;
            requestHash: string;
            capacityTier: 'standard' | 'expanded';
            outcome: 'call_failed' | 'invalid_patch' | 'candidate_rejected' | 'candidate_adopted';
            candidateHash?: string;
            targetFingerprint: string;
            resolvedFingerprints?: string[];
            introducedFingerprints?: string[];
            adopted?: boolean;
            error?: string;
            failure?: AgentResponse<unknown>['failure'];
          }> = [];
          let ownerTaskFindings = prioritizeOwnerRepairFindings((await this.validateNarrativeRealization({
            sceneId: sceneBlueprint.id,
            tasks: canonicalSceneWriterTasks,
            sceneContent,
            mode: 'owner',
            currentStage: 'scene_writer',
            candidateHash: stableHash(sceneContent),
          })).findings.filter((finding) => finding.blocking), canonicalSceneWriterTasks);
          let authoredRepairAttempts = 0;
          let patchCallAttempts = 0;
          let capacityTier: 'standard' | 'expanded' = 'standard';
          let priorPatchFeedback: string[] = [];
          const executedPatchRequestHashes = new Set<string>();
          let lastPatchFailure: AgentResponse<unknown>['failure'] | undefined;
          while (authoredRepairAttempts < 2 && patchCallAttempts < 4 && ownerTaskFindings.length > 0) {
            const repairTarget = ownerTaskFindings[0];
            const targetTask = canonicalSceneWriterTasks.find((task) => task.id === repairTarget.taskId);
            const feedback = ownerTaskFindings
              .map((finding) => `- ${ownerRealizationRepairFeedback(finding, canonicalSceneWriterTasks)}`)
              .concat(priorPatchFeedback.map((line) => `- PRIOR PATCH FEEDBACK: ${line}`))
              .join('\n');
            const targetAtomIds = [...new Set([
              ...(repairTarget.missingEvidenceAtoms ?? []),
              ...(repairTarget.matchedForbiddenAtoms ?? []),
            ])];
            const targetAtomIdSet = new Set(targetAtomIds);
            const targetAtoms = targetTask?.evidenceAtoms.filter((atom) => targetAtomIdSet.has(atom.id)) ?? [];
            const preserveAtoms = targetTask?.evidenceAtoms.filter((atom) =>
              atom.polarity !== 'forbidden' && !targetAtomIdSet.has(atom.id)) ?? [];
            const forbiddenAtoms = canonicalSceneWriterTasks.flatMap((task) =>
              task.evidenceAtoms.filter((atom) => atom.polarity === 'forbidden'));
            const concurrentFindings = ownerTaskFindings.map((finding) =>
              ownerRealizationRepairFeedback(finding, canonicalSceneWriterTasks));
            const requestHash = stableHash({
              baseSceneHash: stableHash(sceneContent),
              targetTaskId: repairTarget.taskId,
              targetAtomIds,
              feedback,
              capacityTier,
            });
            if (executedPatchRequestHashes.has(requestHash)) {
              lastPatchFailure = {
                code: 'agent_call_failed',
                retryClass: 'none',
              };
              ownerRepairHistory.push({
                attempt: patchCallAttempts + 1,
                requestHash,
                capacityTier,
                outcome: 'call_failed',
                targetFingerprint: repairTarget.fingerprint,
                error: 'Duplicate semantic patch request suppressed.',
                failure: lastPatchFailure,
              });
              break;
            }
            executedPatchRequestHashes.add(requestHash);
            patchCallAttempts += 1;
            context.emit({
              type: 'regeneration_triggered',
              phase: 'scenes',
              message: `Scene ${sceneBlueprint.id} is repairing canonical realization fingerprint ${repairTarget.fingerprint} (call ${patchCallAttempts}, authored ${authoredRepairAttempts + 1}/2, ${capacityTier})`,
              data: { repairTarget, findings: ownerTaskFindings, requestHash, capacityTier },
            });
            const ownerTaskRetry = await withTimeout(
              this.deps.sceneWriter.executeSemanticPatch({
                baseSceneHash: stableHash(sceneContent),
                scene: JSON.parse(JSON.stringify(sceneContent)),
                targetTaskId: repairTarget.taskId,
                targetAtomIds,
                targetAtoms,
                preserveAtoms,
                forbiddenAtoms,
                concurrentFindings,
                repairFeedback: feedback,
                capacityTier,
              }),
              PIPELINE_TIMEOUTS.llmAgent,
              `SceneWriter.executeSemanticPatch(${sceneBlueprint.id} owner-realization-retry-${authoredRepairAttempts + 1})`,
            );
            if (!ownerTaskRetry.success || !ownerTaskRetry.data) {
              lastPatchFailure = ownerTaskRetry.failure;
              ownerRepairHistory.push({
                attempt: patchCallAttempts,
                requestHash,
                capacityTier,
                outcome: 'call_failed',
                targetFingerprint: repairTarget.fingerprint,
                error: ownerTaskRetry.error,
                failure: ownerTaskRetry.failure,
              });
              if (ownerTaskRetry.failure?.retryClass === 'adjust_call_budget' && capacityTier === 'standard') {
                capacityTier = 'expanded';
                continue;
              }
              break;
            }
            lastPatchFailure = undefined;
            if (ownerTaskRetry.data.targetAtomIds.some((atomId) => !targetAtomIds.includes(atomId))) continue;
            const authoredAttempt = authoredRepairAttempts + 1;
            authoredRepairAttempts += 1;
            let appliedPatch: ReturnType<typeof applySceneSemanticPatch>;
            try {
              appliedPatch = applySceneSemanticPatch(sceneContent, ownerTaskRetry.data);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              ownerRepairHistory.push({
                attempt: patchCallAttempts,
                authoredAttempt,
                requestHash,
                capacityTier,
                outcome: 'invalid_patch',
                targetFingerprint: repairTarget.fingerprint,
                error: message,
              });
              priorPatchFeedback = [message];
              capacityTier = 'standard';
              context.emit({
                type: 'warning', phase: 'scenes',
                message: `Scene ${sceneBlueprint.id} rejected an invalid semantic patch: ${message}`,
              });
              continue;
            }
            const attempt = authoredAttempt;
            const candidateSnapshot = appliedPatch.scene;
            const candidateHash = stableHash(candidateSnapshot);
            if (outputDirectory) {
              await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-owner-repair-candidate-${attempt}.json`, {
                schemaVersion: 1, episodeNumber: densityEpisodeNumber, sceneId: sceneBlueprint.id,
                attempt, candidateHash, patch: ownerTaskRetry.data,
                changedBeatIds: appliedPatch.changedBeatIds, insertedBeatIds: appliedPatch.insertedBeatIds,
                candidate: candidateSnapshot,
              });
            }
            let retryFindings: RealizationTaskGateFinding[] | undefined;
            for (let judgeAttempt = 1; judgeAttempt <= 2 && !retryFindings; judgeAttempt += 1) {
              try {
                retryFindings = (await this.validateNarrativeRealization({
                  sceneId: sceneBlueprint.id,
                  tasks: canonicalSceneWriterTasks,
                  sceneContent: candidateSnapshot,
                  mode: 'owner',
                  currentStage: 'scene_writer',
                  candidateHash,
                })).findings.filter((finding) => finding.blocking);
              } catch (error) {
                if (!(error instanceof PipelineError) || error.code !== 'semantic_judge_unavailable' || judgeAttempt >= 2) throw error;
              }
            }
            if (!retryFindings) continue;
            const replayFindings = (await this.validateNarrativeRealization({
              sceneId: sceneBlueprint.id,
              tasks: canonicalSceneWriterTasks,
              sceneContent: JSON.parse(JSON.stringify(candidateSnapshot)),
              mode: 'owner',
              currentStage: 'scene_writer',
              candidateHash,
            })).findings.filter((finding) => finding.blocking);
            if (stableHash(retryFindings) !== stableHash(replayFindings)) {
              throw new PipelineError(
                `[OwnerStageValidatorSnapshotMismatch] ${sceneBlueprint.id} produced non-replayable realization findings.`,
                'scenes',
                {
                  agent: 'SceneWriter',
                  context: { sceneId: sceneBlueprint.id, candidateHash, retryFindings, replayFindings },
                  failure: {
                    code: 'validator_snapshot_mismatch',
                    ownerStage: 'scene_writer',
                    retryClass: 'none',
                    issueCodes: ['OWNER_VALIDATOR_SNAPSHOT_MISMATCH'],
                    artifactRefs: [],
                    repairTarget: sceneBlueprint.id,
                  },
                },
              );
            }
            const adoptCandidate = shouldAdoptOwnerRepairCandidate({
              previous: ownerTaskFindings,
              candidate: retryFindings,
              targetFingerprint: repairTarget.fingerprint,
            });
            const previousFingerprints = new Set(ownerTaskFindings.map((finding) => finding.fingerprint));
            const candidateFingerprints = new Set(retryFindings.map((finding) => finding.fingerprint));
            const resolvedFingerprints = [...previousFingerprints].filter((fingerprint) => !candidateFingerprints.has(fingerprint));
            const introducedFingerprints = [...candidateFingerprints].filter((fingerprint) => !previousFingerprints.has(fingerprint));
            ownerRepairHistory.push({
              attempt: patchCallAttempts,
              authoredAttempt: attempt,
              requestHash,
              capacityTier,
              outcome: adoptCandidate ? 'candidate_adopted' : 'candidate_rejected',
              candidateHash,
              targetFingerprint: repairTarget.fingerprint,
              resolvedFingerprints,
              introducedFingerprints,
              adopted: adoptCandidate,
            });
            capacityTier = 'standard';
            if (outputDirectory) {
              await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-owner-repair-attempt-${attempt}.json`, {
                schemaVersion: 2,
                episodeNumber: densityEpisodeNumber,
                sceneId: sceneBlueprint.id,
                attempt,
                repairTarget,
                previousFindings: ownerTaskFindings,
                candidateFindings: retryFindings,
                replayFindings,
                replayVerified: true,
                resolvedFingerprints,
                introducedFingerprints,
                adopted: adoptCandidate,
                candidateHash,
                patch: ownerTaskRetry.data,
                changedBeatIds: appliedPatch.changedBeatIds,
                insertedBeatIds: appliedPatch.insertedBeatIds,
                candidate: candidateSnapshot,
                assignedEventIds: sceneBlueprint.assignedEventIds ?? sceneBlueprint.narrativeEventIds ?? [],
                realizationTasks: canonicalSceneWriterTasks,
              });
            }
            if (adoptCandidate) {
              Object.assign(sceneContent, candidateSnapshot);
              sceneContent.sceneId = sceneBlueprint.id;
              sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
              sceneContent.locationId = sceneSettingContext.locationId;
              sceneContent.settingContext = sceneSettingContext;
              sceneContent.requiredBeats = sceneRealizationBlueprint.requiredBeats;
              sceneContent.signatureMoment = sceneRealizationBlueprint.signatureMoment;
              ownerTaskFindings = prioritizeOwnerRepairFindings(retryFindings, canonicalSceneWriterTasks);
              priorPatchFeedback = [];
            } else {
              priorPatchFeedback = retryFindings.map((finding) =>
                ownerRealizationRepairFeedback(finding, canonicalSceneWriterTasks));
            }
          }
          if (ownerTaskFindings.length > 0) {
            if (outputDirectory) {
              const committedSnapshot = JSON.parse(JSON.stringify(sceneContent));
              await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-realization-blockers.json`, {
                schemaVersion: 3,
                episodeNumber: densityEpisodeNumber,
                sceneId: sceneBlueprint.id,
                candidateHash: stableHash(committedSnapshot),
                candidate: committedSnapshot,
                findings: ownerTaskFindings,
                repairHistory: ownerRepairHistory,
                assignedEventIds: sceneBlueprint.assignedEventIds ?? sceneBlueprint.narrativeEventIds ?? [],
                realizationTasks: canonicalSceneWriterTasks,
              });
            }
            const first = ownerTaskFindings[0];
            throw new PipelineError(
              `[OwnerStageRealizationBlocker] ${sceneBlueprint.id} failed assigned realization task ${first.taskId}: ${first.message}`,
              'scenes',
              {
                agent: 'SceneWriter',
                context: {
                  sceneId: sceneBlueprint.id,
                  findings: ownerTaskFindings,
                  retryBudget: 2,
                  patchCallAttempts,
                  repairHistory: ownerRepairHistory,
                  lastPatchFailure,
                },
                failure: {
                  code: lastPatchFailure?.code === 'visible_output_starved'
                    || lastPatchFailure?.code === 'structured_output_truncated'
                    || lastPatchFailure?.code === 'structured_output_invalid'
                    ? lastPatchFailure.code
                    : 'prose_realization_failed',
                  ownerStage: 'scene_writer',
                  retryClass: lastPatchFailure ? 'none' : 'repair_scene_prose',
                  issueCodes: ownerTaskFindings.map((finding) => finding.code),
                  artifactRefs: outputDirectory
                    ? [`episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-realization-blockers.json`]
                    : [],
                  repairTarget: first.taskId,
                },
              },
            );
          }
          const downstreamEventIds = new Set((sceneBlueprint.realizationTasks ?? [])
            .filter((task) => task.blocking && task.ownerStage !== 'scene_writer')
            .map((task) => task.canonicalEventId ?? task.eventId)
            .filter((eventId): eventId is string => Boolean(eventId)));
          sceneContent.verifiedEventIds = Array.from(new Set(canonicalSceneWriterTasks
            .map((task) => task.canonicalEventId ?? task.eventId)
            .filter((eventId): eventId is string => Boolean(eventId))
            .filter((eventId) => !downstreamEventIds.has(eventId))));
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

        const seasonResiduePlan = brief.seasonPlan?.residuePlan || [];
        const requiredCanonicalStateIds = (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
          .filter((state) => state.sourceEpisodeNumber === brief.episode.number && state.requiredSetterSurface === 'choice_consequence')
          .map((state) => state.canonicalStateId);
        const validateChoiceCandidate = async (choiceSet: ChoiceSet): Promise<{
          ownerBlockers: RealizationTaskGateFinding[];
          producerBlockers: ProducerBlockerFinding[];
        }> => ({
          ownerBlockers: (await this.validateNarrativeRealization({
            sceneId: sceneBlueprint.id,
            tasks: sceneBlueprint.realizationTasks,
            sceneContent,
            choiceSet,
            mode: 'owner',
            currentStage: 'choice_author',
            candidateHash: stableHash(choiceSet),
          })).findings.filter((finding) => finding.blocking),
          producerBlockers: validateChoiceProducerOutput(sceneBlueprint.id, choiceSet),
        });
        const prepareChoiceCandidate = (choiceSet: ChoiceSet, choicePointBeat: GeneratedBeat): ChoiceSet => {
          const candidate = JSON.parse(JSON.stringify({ ...choiceSet, sceneId: sceneBlueprint.id })) as ChoiceSet;
          ensureCanonicalStateSetters(candidate.choices, requiredCanonicalStateIds);
          emitSceneTreatmentSeeds(sceneBlueprint, candidate.choices);
          emitSceneBranchAxes(sceneBlueprint, candidate.choices);
          emitSceneInfoMarkers(sceneBlueprint, candidate.choices);
          const residueBackstop = applyChoiceResidueBackstop(
            {
              beatId: choicePointBeat.id,
              sceneId: sceneBlueprint.id,
              choiceType: sceneBlueprint.choicePoint?.type || 'expression',
              choices: candidate.choices,
              overallStakes: { want: '', cost: '', identity: '' },
              designNotes: '',
            },
            sceneBlueprint,
            seasonResiduePlan,
          );
          if (residueBackstop.addedFlags > 0 || residueBackstop.stamped > 0) {
            context.emit({
              type: 'debug',
              phase: 'choices',
              message: `Residue backstop for ${sceneBlueprint.id}: stamped ${residueBackstop.stamped}, added ${residueBackstop.addedFlags} planned flag(s).`,
            });
          }
          if ((new Set(sceneBlueprint.leadsTo ?? []).size) > 1) {
            const repaired = repairBranchFanOut(candidate.choices, sceneBlueprint.leadsTo, {
              pathHints: branchTargetHintsByScene.get(sceneBlueprint.id),
            });
            if (repaired) {
              const hinted = branchTargetHintsByScene.has(sceneBlueprint.id);
              context.emit({ type: 'warning', phase: 'choices', message: `Repaired branch fan-out for ${sceneBlueprint.id}: re-pointed a choice to its authored target [${[...new Set(sceneBlueprint.leadsTo ?? [])].join(', ')}]${hinted ? ' (matched to authored branch intent)' : ' (no branch-path hints - first-spare fallback)'}.` });
            }
          }
          return candidate;
        };
        const refreshEpisodePlantsForChoiceSet = (choiceSet: ChoiceSet): void => {
          for (let index = episodePlants.length - 1; index >= 0; index--) {
            if (episodePlants[index].sceneId === sceneBlueprint.id) episodePlants.splice(index, 1);
          }
          const projected = { sceneId: sceneBlueprint.id, choices: choiceSet.choices };
          episodePlants.push(...extractPlantsFromChoiceSet(projected, this.deps.callbackLedger));
          episodePlants.push(...extractTintPlantsFromChoiceSet(projected));
          episodePlants.push(...extractBranchResidueFromChoiceSet(projected));
        };

        // Choice Author (for non-encounter scenes with choice points)
        context.emit({ type: 'debug', phase: 'scenes', message: `Scene ${sceneBlueprint.id} choicePoint: ${sceneRealizationBlueprint.choicePoint ? `YES (${sceneRealizationBlueprint.choicePoint.type})` : 'NO'}` });
        if (sceneRealizationBlueprint.choicePoint) {
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
            const assignedResidueIds = new Set(sceneRealizationBlueprint.choicePoint?.residueObligationIds || []);
            const outgoingResidueObligations = seasonResiduePlan.filter((obligation) => assignedResidueIds.has(obligation.id));
            const dueResidueObligations = seasonResiduePlan.filter((obligation) =>
              sceneBlueprint.residueObligationIds?.includes(obligation.id) &&
              obligation.targetEpisodeNumbers.includes(brief.episode.number)
            );

            const choiceAuthorInput: ChoiceAuthorInput = {
              sceneBlueprint: sceneRealizationBlueprint,
              beatText: choicePointBeat.text,
              beatId: choicePointBeat.id,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: brief.userPrompt,
                worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneRealizationBlueprint.location)?.fullDescription),
              },
              protagonistInfo: {
                name: brief.protagonist.name,
                pronouns: brief.protagonist.pronouns,
              },
              npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneRealizationBlueprint.npcsPresent, characterBible),
              availableFlags: blueprint.suggestedFlags,
              authoredFlagContracts: (brief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === (episodeNumber ?? brief.episode.number))?.setsFlags ?? [])
                .map((flag) => ({ name: flag.flag, description: flag.description || flag.flag })),
              canonicalStateContracts: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                .filter((state) => state.sourceEpisodeNumber === brief.episode.number || state.targetEpisodeNumbers.includes(brief.episode.number))
                .map((state) => ({ canonicalStateId: state.canonicalStateId, aliases: state.aliases, sourceEpisodeNumber: state.sourceEpisodeNumber, targetEpisodeNumbers: state.targetEpisodeNumbers })),
              requiredCanonicalStateIds: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                .filter((state) => state.sourceEpisodeNumber === brief.episode.number && state.requiredSetterSurface === 'choice_consequence')
                .map((state) => state.canonicalStateId),
              availableScores: blueprint.suggestedScores,
              availableTags: blueprint.suggestedTags,
              // B1: sealed canon as authoritative "do not contradict" context.
              establishedCanon: this.deps.establishedCanonForPrompt(brief.episode?.number),
              unresolvedCallbacks: this.deps.getUnresolvedCallbacksForPrompt(brief.episode?.number) as ChoiceAuthorInput['unresolvedCallbacks'],
              outgoingResidueObligations,
              dueResidueObligations,
              disallowedUnplannedResidueFlags: seasonResiduePlan
                .filter((obligation) => obligation.sourceEpisodeNumber !== brief.episode.number)
                .map((obligation) => obligation.flag),
              possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                const scene = blueprint.scenes.find(s => s.id === id);
                return {
                  id,
                  name: scene?.name || id,
                  description: scene?.description || '',
                };
              }),
              optionCount: sceneRealizationBlueprint.choicePoint?.optionHints?.length || 3,
              sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
              memoryContext: await this.memoryContextFor('ChoiceAuthor', 'choice-authoring', brief, sceneRealizationBlueprint, ['choice-set']),
              storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
              growthTemplates: (() => {
                // Attach the episode-level growth template to the FIRST
                // strategic choice point (the development scene anchor).
                if (!episodeGrowthTemplate || growthTemplateAttached) return undefined;
                const isStrategic = sceneRealizationBlueprint.choicePoint?.type === 'strategic';
                const isTransition = sceneRealizationBlueprint.purpose === 'transition';
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
                  isBranchPoint: leadsToDistinct > 1 || ((sceneRealizationBlueprint.choicePoint?.type as string) === 'branching'),
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
              seasonStoryCircle: brief.seasonPlan?.storyCircle,
              episodeStoryCircleRole: brief.seasonPlan?.episodes.find(
                (e) => e.episodeNumber === brief.episode.number,
              )?.storyCircleRole,
              episodeCircle: blueprint.episodeCircle,
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
            const choiceRealizationFindings = async (choiceSet: ChoiceSet | undefined): Promise<RealizationTaskGateFinding[]> =>
              choiceSet
                ? (await this.validateNarrativeRealization({
                    sceneId: sceneBlueprint.id,
                    tasks: sceneBlueprint.realizationTasks,
                    sceneContent,
                    choiceSet,
                    mode: 'owner',
                    currentStage: 'choice_author',
                    candidateHash: stableHash(choiceSet),
                  })).findings
                : [];
            let choiceAuthorAttempt = 1;
            let choiceResult = await authorChoices(choiceAuthorInput, `ChoiceAuthor.execute(${sceneBlueprint.id})`);
            let choiceOwnerBlockers = choiceResult.success && choiceResult.data
              ? (await choiceRealizationFindings(choiceResult.data)).filter((finding) => finding.blocking)
              : [];
            let choiceProducerBlockers = choiceResult.success && choiceResult.data
              ? validateChoiceProducerOutput(sceneBlueprint.id, choiceResult.data)
              : [];
            while ((!choiceResult.success || !choiceResult.data || choiceOwnerBlockers.length > 0 || choiceProducerBlockers.length > 0) && choiceAuthorAttempt < maxChoiceAuthorAttempts) {
              choiceAuthorAttempt++;
              const realizationFeedback = choiceOwnerBlockers.length > 0 || choiceProducerBlockers.length > 0
                ? [
                    ...choiceOwnerBlockers.map((finding) => ownerRealizationRepairFeedback(finding, sceneBlueprint.realizationTasks)),
                    ...choiceProducerBlockers.map((finding) => `${finding.fieldPath}: ${finding.message}`),
                  ].join('; ')
                : undefined;
              context.emit({ type: 'warning', phase: 'choices', message: `Choice Author failed on ${sceneBlueprint.id} (attempt ${choiceAuthorAttempt - 1}/${maxChoiceAuthorAttempts}): ${realizationFeedback ?? choiceResult.error ?? 'no data'} — retrying.` });
              // R6: feed the failure back instead of re-running the identical
              // prompt — a parse/schema failure repeats deterministically
              // unless the model is told what went wrong last time.
              const retryFeedbackInput: ChoiceAuthorInput = {
                ...choiceAuthorInput,
                storyContext: {
                  ...choiceAuthorInput.storyContext,
                  userPrompt: `${choiceAuthorInput.storyContext.userPrompt || ''}\n\nIMPORTANT - Your previous choice-authoring attempt FAILED with: ${realizationFeedback ?? choiceResult.error ?? 'no data returned'}. Fix that specific problem this time. Return one complete, valid choice set exactly matching the requested JSON structure.`,
                },
              };
              choiceResult = await authorChoices(retryFeedbackInput, `ChoiceAuthor.execute(${sceneBlueprint.id} retry-${choiceAuthorAttempt})`);
              choiceOwnerBlockers = choiceResult.success && choiceResult.data
                ? (await choiceRealizationFindings(choiceResult.data)).filter((finding) => finding.blocking)
                : [];
              choiceProducerBlockers = choiceResult.success && choiceResult.data
                ? validateChoiceProducerOutput(sceneBlueprint.id, choiceResult.data)
                : [];
            }

            // Per-target branch regeneration (preferred over a templated fallback): if the
            // choices still failed AND this is a multi-target branch point with authored
            // target intents, re-run ChoiceAuthor with explicit one-choice-per-target
            // guidance so the LLM authors a REAL, coherent choice for each branch. On
            // success, promote it so the normal success path (emitters, plants, validation,
            // fan-out repair) runs uniformly.
            const branchRegenHints = branchTargetHintsByScene.get(sceneBlueprint.id);
            if (
              (!choiceResult.success || !choiceResult.data || choiceOwnerBlockers.length > 0 || choiceProducerBlockers.length > 0)
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
              const branchRegenBlockers = branchRegen.success && branchRegen.data
                ? (await choiceRealizationFindings(branchRegen.data)).filter((finding) => finding.blocking)
                : [];
              const branchRegenProducerBlockers = branchRegen.success && branchRegen.data
                ? validateChoiceProducerOutput(sceneBlueprint.id, branchRegen.data)
                : [];
              if (branchRegen.success && branchRegen.data && (branchRegen.data.choices?.length ?? 0) > 0 && branchRegenBlockers.length === 0 && branchRegenProducerBlockers.length === 0) {
                choiceResult = branchRegen;
                choiceOwnerBlockers = [];
                choiceProducerBlockers = [];
                context.emit({ type: 'warning', phase: 'choices', message: `Authored ${sceneBlueprint.id} branch choices via per-target regeneration (one coherent choice per branch) — no templated fallback needed.` });
              }
            }

            if (!choiceResult.success || !choiceResult.data || choiceOwnerBlockers.length > 0 || choiceProducerBlockers.length > 0) {
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
                (sceneBlueprint.setsUpInfoIds ?? []).length > 0 ||
                (sceneBlueprint.revealsInfoIds ?? []).length > 0 ||
                (sceneBlueprint.paysOffInfoIds ?? []).length > 0;
              const fallbackChoiceSet =
                this.deps.buildBranchFallbackChoiceSet(sceneBlueprint, choicePointBeat)
                ?? (declaresOnPageContract || sceneBlueprint.choicePoint
                  ? this.deps.buildDeterministicChoiceSet(sceneBlueprint, choicePointBeat)
                  : undefined);
              if (fallbackChoiceSet) {
                const preparedFallback = prepareChoiceCandidate(fallbackChoiceSet, choicePointBeat);
                const fallbackValidation = await validateChoiceCandidate(preparedFallback);
                if (fallbackValidation.ownerBlockers.length > 0 || fallbackValidation.producerBlockers.length > 0) {
                  throw new PipelineError(
                    `[OwnerStageRealizationBlocker] ${sceneBlueprint.id} deterministic choice fallback cannot satisfy its assigned choice contract.`,
                    'content_generation',
                    { agent: 'ChoiceAuthor', context: { sceneId: sceneBlueprint.id, findings: [...fallbackValidation.ownerBlockers, ...fallbackValidation.producerBlockers] } },
                  );
                }
                choiceSets.push(preparedFallback);
                refreshEpisodePlantsForChoiceSet(preparedFallback);
                context.emit({ type: 'warning', phase: 'choices', message: `Inserted deterministic fallback choice set for ${sceneBlueprint.id} (${preparedFallback.choices.length} choice(s)) and planted its on-page contracts after ChoiceAuthor failed.` });
              }
            } else {
            const preparedChoiceSet = prepareChoiceCandidate(choiceResult.data, choicePointBeat);
            const preparedValidation = await validateChoiceCandidate(preparedChoiceSet);
            if (preparedValidation.ownerBlockers.length > 0 || preparedValidation.producerBlockers.length > 0) {
              throw new PipelineError(
                `[ChoiceCommitBlocker] ${sceneBlueprint.id} failed its choice contract after deterministic projections were applied.`,
                'choices',
                { agent: 'ChoiceAuthor', context: { sceneId: sceneBlueprint.id, findings: [...preparedValidation.ownerBlockers, ...preparedValidation.producerBlockers] } },
              );
            }
            choiceResult.data = preparedChoiceSet;
            const choiceAdvisories = (await choiceRealizationFindings(choiceResult.data)).filter((finding) => !finding.blocking);
            if (choiceAdvisories.length > 0) {
              context.emit({
                type: 'warning',
                phase: 'choices',
                message: `Choice set ${sceneBlueprint.id} has ${choiceAdvisories.length} advisory realization finding(s).`,
                data: { findings: choiceAdvisories },
              });
            }
            const choiceVerifiedEventIds = (sceneBlueprint.realizationTasks ?? [])
              .filter((task) => task.ownerStage === 'choice_author')
              .map((task) => task.canonicalEventId ?? task.eventId)
              .filter((eventId): eventId is string => Boolean(eventId));
            sceneContent.verifiedEventIds = Array.from(new Set([
              ...(sceneContent.verifiedEventIds ?? []),
              ...choiceVerifiedEventIds,
            ]));
            choiceSets.push(choiceResult.data);
            refreshEpisodePlantsForChoiceSet(choiceResult.data);

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
                      sceneBlueprint: sceneRealizationBlueprint,
                      beatText: choicePointBeat.text,
                      beatId: choicePointBeat.id,
                      storyContext: {
                        title: brief.story.title,
                        genre: brief.story.genre,
                        tone: brief.story.tone,
                        userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Fix these stakes issues: ${currentStakesResult.issues.map(i => i.issue).join('; ')}`,
                        worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneRealizationBlueprint.location)?.fullDescription),
                      },
                      protagonistInfo: {
                        name: brief.protagonist.name,
                        pronouns: brief.protagonist.pronouns,
                      },
                      npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneRealizationBlueprint.npcsPresent, characterBible),
                      availableFlags: blueprint.suggestedFlags,
                      authoredFlagContracts: (brief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === (episodeNumber ?? brief.episode.number))?.setsFlags ?? [])
                        .map((flag) => ({ name: flag.flag, description: flag.description || flag.flag })),
                      canonicalStateContracts: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                        .filter((state) => state.sourceEpisodeNumber === brief.episode.number || state.targetEpisodeNumbers.includes(brief.episode.number))
                        .map((state) => ({ canonicalStateId: state.canonicalStateId, aliases: state.aliases, sourceEpisodeNumber: state.sourceEpisodeNumber, targetEpisodeNumbers: state.targetEpisodeNumbers })),
                      requiredCanonicalStateIds: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                        .filter((state) => state.sourceEpisodeNumber === brief.episode.number && state.requiredSetterSurface === 'choice_consequence')
                        .map((state) => state.canonicalStateId),
                      availableScores: blueprint.suggestedScores,
                      availableTags: blueprint.suggestedTags,
                      possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                        const scene = blueprint.scenes.find(s => s.id === id);
                        return { id, name: scene?.name || id, description: scene?.description || '' };
                      }),
                      optionCount: sceneRealizationBlueprint.choicePoint?.optionHints?.length || 3,
                      sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                      memoryContext: await this.memoryContextFor('ChoiceAuthor', 'choice-stakes-repair', brief, sceneRealizationBlueprint, ['choice-set']),
                      storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
                    }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id} regen)`);

                    if (revisedChoiceResult.success && revisedChoiceResult.data) {
                      const preparedRevision = prepareChoiceCandidate(revisedChoiceResult.data, choicePointBeat);
                      const revisionValidation = await validateChoiceCandidate(preparedRevision);
                      if (revisionValidation.ownerBlockers.length > 0 || revisionValidation.producerBlockers.length > 0) {
                        context.emit({
                          type: 'warning',
                          phase: 'choices',
                          message: `Rejected stakes rewrite for ${sceneBlueprint.id}: the candidate regressed its committed realization contract.`,
                          data: { findings: [...revisionValidation.ownerBlockers, ...revisionValidation.producerBlockers] },
                        });
                        continue;
                      }
                      currentChoiceData = preparedRevision;
                      currentStakesResult = this.deps.incrementalValidator.validateStakes(currentChoiceData);

                      choiceSets[choiceSets.length - 1] = currentChoiceData;
                      refreshEpisodePlantsForChoiceSet(currentChoiceData);
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
              const committedChoiceSet = choiceSets[choiceSets.length - 1] ?? choiceResult.data;
              for (const choice of committedChoiceSet.choices) {
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

          const sceneChoiceSet = findChoiceSetForScene(choiceSets, sceneContent);

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
            // R8: a scene that failed incremental POV/voice validation is a
            // SceneCritic candidate for the flag-gated pass.
            flagSceneForCritic(sceneContent, 'incremental-validation-regen');
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
            // R6: one extraction for both the triggering issues and the
            // post-regen re-check, so adoption compares like with like.
            const collectRegenIssues = (validation: typeof sceneValidation): string[] => {
              const issues: string[] = [];
              if (validation.povClarity && validation.povClarity.issues.length > 0) {
                issues.push(
                  ...validation.povClarity.issues.map(i => `POV clarity issue: ${i.issue} ${i.suggestion}`)
                );
              }
              if (validation.voice && validation.voice.issues.length > 0) {
                issues.push(
                  ...validation.voice.issues.map(i => `Voice issue (${i.characterName}): ${i.issue}`)
                );
              }
              if (validation.continuity && validation.continuity.issues.length > 0) {
                issues.push(
                  ...validation.continuity.issues.map(i => `Continuity: ${i.detail}`)
                );
              }
              return issues;
            };

            while (sceneRegenAttempt < maxSceneRegenAttempts) {
              sceneRegenAttempt++;
              this.deps.remediationBudget?.spend(1); // S3: debit one regeneration attempt
              const issueDescriptions = collectRegenIssues(sceneValidation);

              context.emit({
                type: 'regeneration_triggered',
                phase: 'scenes',
                message: `Regenerating scene ${sceneBlueprint.id} for POV/voice/continuity (attempt ${sceneRegenAttempt}/${maxSceneRegenAttempts})`,
                data: { reason: issueDescriptions },
              });

              // R6: regenerate from the FULL original SceneWriter input (the
              // same compacted input the scene was first authored from — all
              // contracts, timeline handoff, directives, canon), with the
              // triggering issues + the failing draft appended. The old
              // hand-rebuilt input dropped most contract context, so regens
              // routinely traded the POV fix for a new fidelity miss.
              const revisedSceneResult = await withTimeout(this.deps.sceneWriter.execute({
                ...sceneWriterInputForAuthoring,
                storyContext: {
                  ...sceneWriterInputForAuthoring.storyContext,
                  userPrompt: `${sceneWriterInputForAuthoring.storyContext.userPrompt || ''}\n\nIMPORTANT - Fix these issues from validation:\n${issueDescriptions.join('\n')}\n\nEXISTING SCENE CONTENT TO PRESERVE STRUCTURALLY:\n${JSON.stringify(sceneContent).slice(0, 12000)}\n\nFor POV clarity fixes, rewrite only prose/textVariants needed to anchor POV to the player character. Preserve beat IDs, visual contract fields, choice-point flags, thread IDs, callback IDs, and navigation. The first non-empty beat must use you/your, the protagonist name, or a concrete pronoun before focusing on NPCs, setting, or exposition. Do not emit template variables.`,
                },
                memoryContext: await this.memoryContextFor('SceneWriter', 'scene-regeneration', brief, sceneBlueprint, ['scene-content']),
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
              revisedContent.requiredBeats = sceneRealizationBlueprint.requiredBeats;
              revisedContent.signatureMoment = sceneRealizationBlueprint.signatureMoment;

              // Realization guard: a POV/voice rewrite must not LOSE an
              // authored moment the current prose depicts — the season-final
              // realization validators block on it and a voice win is not
              // worth a contract abort. Deterministic check, no LLM.
              if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
                const lost = rewriteLosesRequiredMoment(sceneRealizationBlueprint, sceneContent.beats, revisedContent.beats);
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

              // R6: adopt only when the triggering issue fingerprints actually
              // cleared (or validation came back clean) — a bare score bump
              // that keeps the same defect fingerprints is not an improvement.
              if (revisedValidation.regenerationRequested === 'none' ||
                  shouldAdoptRegenAttempt(issueDescriptions, collectRegenIssues(revisedValidation))) {
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
                    sceneBlueprint: sceneRealizationBlueprint,
                    beatText: regenChoicePointBeat.text,
                    beatId: regenChoicePointBeat.id,
                    storyContext: {
                      title: brief.story.title,
                      genre: brief.story.genre,
                      tone: brief.story.tone,
                      userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL CHOICE FIXES REQUIRED — the choice set failed stakes validation. Fix these issues:\n${stakesIssueDescriptions}`,
                      worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneRealizationBlueprint.location)?.fullDescription),
                    },
                    protagonistInfo: {
                      name: brief.protagonist.name,
                      pronouns: brief.protagonist.pronouns,
                    },
                    npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneRealizationBlueprint.npcsPresent, characterBible),
                    availableFlags: blueprint.suggestedFlags,
                    authoredFlagContracts: (brief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === (episodeNumber ?? brief.episode.number))?.setsFlags ?? [])
                      .map((flag) => ({ name: flag.flag, description: flag.description || flag.flag })),
                    canonicalStateContracts: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                      .filter((state) => state.sourceEpisodeNumber === brief.episode.number || state.targetEpisodeNumbers.includes(brief.episode.number))
                      .map((state) => ({ canonicalStateId: state.canonicalStateId, aliases: state.aliases, sourceEpisodeNumber: state.sourceEpisodeNumber, targetEpisodeNumbers: state.targetEpisodeNumbers })),
                    requiredCanonicalStateIds: (brief.seasonPlan?.scenePlan?.narrativeContractGraph?.stateContracts ?? [])
                      .filter((state) => state.sourceEpisodeNumber === brief.episode.number && state.requiredSetterSurface === 'choice_consequence')
                      .map((state) => state.canonicalStateId),
                    availableScores: blueprint.suggestedScores,
                    availableTags: blueprint.suggestedTags,
                    possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                      const scene = blueprint.scenes.find(s => s.id === id);
                      return { id, name: scene?.name || id, description: scene?.description || '' };
                    }),
                    optionCount: sceneRealizationBlueprint.choicePoint?.optionHints?.length || 3,
                    sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                    memoryContext: await this.memoryContextFor('ChoiceAuthor', 'choice-regeneration', brief, sceneRealizationBlueprint, ['choice-set']),
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

                  const revisedChoiceSet = prepareChoiceCandidate(revisedChoiceResult.data, regenChoicePointBeat);
                  const revisionValidation = await validateChoiceCandidate(revisedChoiceSet);
                  if (revisionValidation.ownerBlockers.length > 0 || revisionValidation.producerBlockers.length > 0) {
                    context.emit({
                      type: 'warning',
                      phase: 'choices',
                      message: `Rejected choice regeneration for ${sceneBlueprint.id}: the candidate regressed its committed realization contract.`,
                      data: { findings: [...revisionValidation.ownerBlockers, ...revisionValidation.producerBlockers] },
                    });
                    continue;
                  }
                  const revisedStakes = this.deps.incrementalValidator.validateStakes(revisedChoiceSet);

                  if (isChoiceRegenImprovement(currentStakes.issues.length, revisedStakes.issues.length, revisedStakes.passed)) {
                    // Accept the rewrite: swap it into the choiceSets holder and
                    // refresh the recorded scene validation result.
                    choiceSets[choiceSetIdx] = revisedChoiceSet;
                    currentChoiceSet = revisedChoiceSet;
                    refreshEpisodePlantsForChoiceSet(revisedChoiceSet);
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
        const encounterStagingText = [
          sceneBlueprint.name,
          sceneBlueprint.description,
          sceneBlueprint.encounterDescription,
          sceneBlueprint.encounterCentralConflict,
          ...(sceneBlueprint.encounterBeatPlan || []),
          ...(sceneBlueprint.keyBeats || []),
          plannedEnc?.description,
          plannedEnc?.centralConflict,
          plannedEnc?.stakes,
        ].filter(Boolean).join(' ');
        const rosterForIntro = characterBible.characters
          .filter((c) => c.id !== brief.protagonist.id)
          .map((c) => ({ id: c.id, name: c.name }));
        const isAnonymousPlantRef = (npcId: string): boolean => {
          const resolved = resolveRosterCharacter(npcId, rosterForIntro);
          const characterName = resolved?.name
            || (String(npcId).includes(' ') ? String(npcId) : String(npcId).replace(/^char-/, '').replace(/-/g, ' '));
          return resolveCharacterIntroMode({ characterName, stagingText: encounterStagingText }) === 'anonymous_plant';
        };
        const encounterRequiredNpcIds = filterProtagonistEncounterRefs(
          collectEncounterParticipantRefs(sceneBlueprint, plannedEnc),
          brief.protagonist,
        ).filter(isStageablePresent).filter((npcId) => !isAnonymousPlantRef(npcId));
        
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
        const targetBeatCount = uncappedTargetBeatCount;

        // Extract protagonist skills from character profile if available
        const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);
        const protagonistSkills = protagonistProfile?.skills?.map(s => ({
          name: s.name,
          level: s.level || 1,
        })) || [];

        // On-page introduction state for encounter NPCs (mirrors SceneWriter).
        const introducedBeforeEncounter = introducedNpcIds({
          episodeNumber: brief.episode.number,
          rosterNpcIds: rosterForIntro.map((c) => c.id),
          characterIntroductions: brief.seasonPlan?.characterIntroductions,
          alreadyStagedNpcIds: sceneContents.flatMap((content) => [
            ...(content.charactersInvolved || []),
            ...npcIdsNamedInProse(
              (content.beats || [])
                .flatMap((beat) => [
                  beat.text,
                  (beat as { setupText?: string }).setupText,
                  (beat as { escalationText?: string }).escalationText,
                  ...((beat as { textVariants?: Array<{ text?: string }> }).textVariants || []).map((v) => v.text),
                ])
                .filter(Boolean)
                .join(' '),
              rosterForIntro,
            ),
          ]),
        });

        // Build NPCs list - add a fallback antagonist if none present for combat/chase encounters
        // Also include anonymous-plant participants as prompt-only (not cast as named roster).
        const anonymousPlantRefs = filterProtagonistEncounterRefs(
          collectEncounterParticipantRefs(sceneBlueprint, plannedEnc),
          brief.protagonist,
        ).filter(isStageablePresent).filter(isAnonymousPlantRef);

        const identityScheduleFor = (npcId: string) =>
          sceneBlueprint.identityScheduleContracts?.find((contract) => contract.characterId === npcId);
        const promptSafeIdentityText = (npcId: string, text: string, anonymous = false): string => {
          const schedule = identityScheduleFor(npcId);
          if (!schedule || (episodeNumber ?? brief.episode.number) >= schedule.firstNamedEpisode) return text;
          const replacement = anonymous ? 'the stranger' : (schedule.allowedAliases[0] || 'the unnamed figure');
          return [schedule.canonicalName, ...schedule.forbiddenBeforeNamedEpisode]
            .filter(Boolean)
            .reduce((value, forbidden) => value.replace(new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'gi'), replacement), text);
        };
        const promptSafeNpcName = (npcId: string, fallback: string, anonymous = false): string => {
          const schedule = identityScheduleFor(npcId);
          if (!schedule || (episodeNumber ?? brief.episode.number) >= schedule.firstNamedEpisode) return fallback;
          return anonymous ? 'the stranger' : (schedule.allowedAliases[0] || 'the unnamed figure');
        };

        let npcsInvolved = [
          ...encounterRequiredNpcIds.map(npcId => {
            const profile = resolveCharacterProfile(characterBible.characters, npcId);
            const npcBrief = brief.npcs.find(n => n.id === npcId);
            const isFirst = !isIntroducedNpc(introducedBeforeEncounter, npcId);
            const promptName = promptSafeNpcName(npcId, profile?.name || npcId);
            return {
              id: npcId,
              name: promptName,
              pronouns: (profile?.pronouns || 'they/them') as 'he/him' | 'she/her' | 'they/them',
              role: (npcBrief?.role === 'antagonist' ? 'enemy' :
                     npcBrief?.role === 'ally' || npcBrief?.role === 'love_interest' || npcBrief?.role === 'mentor' ? 'ally' :
                     npcBrief?.role === 'neutral' ? 'neutral' : 'obstacle') as 'ally' | 'enemy' | 'neutral' | 'obstacle',
              description: promptSafeIdentityText(npcId, profile?.overview || ''),
              physicalDescription: promptSafeIdentityText(npcId, profile?.physicalDescription || ''),
              voiceNotes: profile?.voiceProfile?.writingGuidance || '',
              isFirstOnPageAppearance: isFirst,
              introMode: (isFirst ? 'named' : undefined) as 'named' | 'anonymous_plant' | undefined,
            };
          }),
          ...anonymousPlantRefs.map(npcId => {
            const profile = resolveCharacterProfile(characterBible.characters, npcId);
            const npcBrief = brief.npcs.find(n => n.id === npcId);
            return {
              id: npcId,
              name: promptSafeNpcName(npcId, profile?.name || npcId, true),
              pronouns: (profile?.pronouns || 'they/them') as 'he/him' | 'she/her' | 'they/them',
              role: (npcBrief?.role === 'antagonist' ? 'enemy' :
                     npcBrief?.role === 'ally' || npcBrief?.role === 'love_interest' || npcBrief?.role === 'mentor' ? 'ally' :
                     npcBrief?.role === 'neutral' ? 'neutral' : 'obstacle') as 'ally' | 'enemy' | 'neutral' | 'obstacle',
              description: promptSafeIdentityText(npcId, profile?.overview || profile?.physicalDescription || 'A stranger with distinctive visual cues', true),
              physicalDescription: promptSafeIdentityText(npcId, profile?.physicalDescription || '', true),
              voiceNotes: profile?.voiceProfile?.writingGuidance || '',
              isFirstOnPageAppearance: true,
              introMode: 'anonymous_plant' as const,
            };
          }),
        ];

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
            physicalDescription: '',
            voiceNotes: '',
            isFirstOnPageAppearance: true,
            introMode: 'anonymous_plant' as const,
          }];
        }

        const notYetIntroducedNames = forbiddenNpcNames({
          roster: rosterForIntro,
          introduced: introducedBeforeEncounter,
          // Anonymous plants are in the prompt cast but must stay on the ban-list
          // so the architect does not name their roster identity.
          sceneCastIds: encounterRequiredNpcIds,
        });

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
        // R2: already-written scenes contribute their REALIZED closing prose,
        // not just the blueprint blurb, so the encounter picks up from what
        // the reader actually saw.
        const sceneOrder = blueprint.scenes || [];
        const encounterSceneIdx = sceneOrder.findIndex((sc) => sc.id === sceneBlueprint.id);
        const episodeSoFarSummary = encounterSceneIdx > 0
          ? buildRealizedEpisodeSoFarSummary(
              sceneOrder.slice(0, encounterSceneIdx),
              (sceneId) => sceneContents.find((sc) => sc.sceneId === sceneId),
            )
          : undefined;

        const encounterInput: EncounterArchitectInput = {
          episodeNumber: episodeNumber ?? brief.episode.number,
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          sceneDescription: sceneBlueprint.description,
          sceneMood: sceneBlueprint.mood,
          sceneLocation: sceneBlueprint.location,
          // Timeline handoff across the encounter seam — the audited hard cuts
          // (e.g. afternoon bookshop → 4am rooftop) happened at encounter scenes.
          // R2: hand off from the GRAPH predecessor (branch-aware) when realized.
          sceneTimeline: buildRealizedTimelineHandoff(
            blueprint.scenes || [],
            sceneBlueprint,
            graphPredecessor?.blueprint,
          ),
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
          encounterStoryCircleTarget: sceneBlueprint.encounterStoryCircleTarget || plannedEnc?.storyCircleTarget,
          encounterStoryCircleTargetRationale: sceneBlueprint.encounterStoryCircleTargetRationale || plannedEnc?.storyCircleTargetRationale,
          encounterStoryCircleTargetEvidence: sceneBlueprint.encounterStoryCircleTargetEvidence || plannedEnc?.storyCircleTargetEvidence,
          encounterStakes: sceneBlueprint.encounterStakes || plannedEnc?.stakes,
          // Authored-treatment anchor (G12): the architect must SEE the
          // authored texts to realize them — EncounterAnchorContentValidator
          // blocks the run when one is missing from the encounter's prose.
          requiredBeats: sceneBlueprint.requiredBeats?.map((beat) => ({
            id: beat.id,
            mustDepict: beat.mustDepict,
            tier: beat.tier,
          })),
          canonicalEventEvidenceRequirements: sceneBlueprint.canonicalEvidenceRequirements,
          realizationTasks: sceneBlueprint.realizationTasks,
          signatureMoment: sceneBlueprint.signatureMoment,
          centralConflict: sceneBlueprint.encounterCentralConflict || plannedEnc?.centralConflict,
          encounterSpineProfile: sceneBlueprint.encounterProfile
            || (plannedEnc as { encounterProfile?: string } | undefined)?.encounterProfile as EncounterArchitectInput['encounterSpineProfile'],
          encounterRequiredNpcIds,
          characterPresenceContracts: sceneBlueprint.characterPresenceContracts,
          identityScheduleContracts: sceneBlueprint.identityScheduleContracts,
          characterRoleConstraints: sceneBlueprint.characterRoleConstraints,
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
          notYetIntroducedNames,
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
            [...(sceneBlueprint.revealsInfoIds ?? []), ...(sceneBlueprint.paysOffInfoIds ?? [])],
          ),
          memoryContext: await this.memoryContextFor('EncounterArchitect', 'encounter-authoring', brief, sceneBlueprint, ['encounter-structure']),
          storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonStoryCircle: brief.seasonPlan?.storyCircle,
          episodeStoryCircleRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.storyCircleRole,
          episodeCircle: blueprint.episodeCircle,
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

        // Relationship snapshot for the relationship dynamics analysis in the
        // phased encounter generator. R2: layer the REALIZED path-specific
        // relationship gains tracked from prior scenes' choice consequences
        // (incremental validator upper bound) over the bible's initial stats,
        // so the encounter reads relationships as they stand, not as-cast.
        const playerRelationships: Record<string, import('../../../types').Relationship> = {};
        for (const npc of npcsInvolved) {
          const profile = characterBible.characters.find(c => c.id === npc.id);
          const stats = profile?.initialStats;
          const realizedDim = (dimension: 'trust' | 'affection' | 'respect' | 'fear'): number => {
            const initial = stats?.[dimension] ?? 0;
            const upperBound = this.deps.incrementalValidator?.getRelationshipUpperBound(npc.id, dimension);
            return typeof upperBound === 'number' ? Math.max(initial, upperBound) : initial;
          };
          playerRelationships[npc.id] = {
            npcId: npc.id,
            trust: realizedDim('trust'),
            affection: realizedDim('affection'),
            respect: realizedDim('respect'),
            fear: realizedDim('fear'),
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
        // P3: attempt summaries / phase errors from failed attempts, persisted
        // into the quarantine record and the pipeline error log on abort.
        let lastEncounterFailureDiagnostics: Record<string, unknown> | undefined;
        const encounterRealizationFindings = async (encounter: EncounterStructure | undefined): Promise<RealizationTaskGateFinding[]> => {
          const ownerSceneContent = sceneContents.find((candidate) => candidate.sceneId === sceneBlueprint.id);
          return (await this.validateNarrativeRealization({
            sceneId: sceneBlueprint.id,
            tasks: sceneBlueprint.realizationTasks,
            sceneContent: ownerSceneContent,
            choiceSet: ownerSceneContent ? findChoiceSetForScene(choiceSets, ownerSceneContent) : undefined,
            encounter,
            mode: 'owner',
            currentStage: 'encounter_architect',
            candidateHash: stableHash(encounter),
          })).findings;
        };
        const maxEncounterAttempts = 2;
        for (let encAttempt = 1; encAttempt <= maxEncounterAttempts; encAttempt++) {
          // Failure-class-aware retry (P1): prompt feedback only helps content
          // defects. A truncation (output-budget) failure cannot be fixed by
          // growing the input — route the retry into the architect's decomposed
          // budget-recovery ladder (strictly smaller calls) instead.
          const budgetFailure = lastEncounterFailure
            ? classifyPhaseError(new Error(lastEncounterFailure)) === 'max_tokens'
            : false;
          const attemptInput: EncounterArchitectInput = !lastEncounterFailure
            ? encounterInput
            : budgetFailure
              ? { ...encounterInput, budgetRecovery: true }
              : {
                  ...encounterInput,
                  storyContext: {
                    ...encounterInput.storyContext,
                    userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nPREVIOUS ATTEMPT FAILED: ${lastEncounterFailure}\nAddress the failure and return the complete, valid encounter JSON.`,
                  },
                };
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
                const turnRealization = assessEncounterTurnRealization(sceneBlueprint, attemptResult.data);
                if (!turnRealization.passed) {
                  lastEncounterFailure = `EncounterArchitect under-realized authored encounter turn(s):\n${formatEncounterTurnRealizationFeedback(turnRealization)}\nAuthor the missing moment in setupText, outcome narrativeText, nested nextSituation setupText, or storylet beat prose before returning JSON.`;
                } else {
                  const encounterOwnerBlockers = (await encounterRealizationFindings(attemptResult.data))
                    .filter((finding) => finding.blocking);
                  if (encounterOwnerBlockers.length > 0) {
                    lastEncounterFailure = `EncounterArchitect missed canonical owner-stage realization task(s): ${encounterOwnerBlockers.map((finding) => ownerRealizationRepairFeedback(finding, sceneBlueprint.realizationTasks)).join('; ')}`;
                  } else {
                    encounterResult = attemptResult;
                    break;
                  }
                }
              }
            } else {
              lastEncounterFailure = attemptResult.error || 'EncounterArchitect returned no data';
              if (attemptResult.metadata) lastEncounterFailureDiagnostics = attemptResult.metadata;
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

        const plantEncounterInfoMarkers = (encounter: EncounterStructure): void => {
          const added = emitSceneInfoMarkersOnBeats(sceneBlueprint, encounterInfoMarkerTargets(encounter as any));
          if (added > 0) {
            context.emit({
              type: 'debug',
              phase: 'encounters',
              message: `Planted ${added} deterministic information-ledger marker(s) on encounter ${sceneBlueprint.id}.`,
            });
          }
        };

        if (!encounterResult) {
          // UNIT QUARANTINE (P2): do NOT abort the run here. Quarantine this
          // unit, keep generating (and checkpointing) every other scene, and
          // give it one escalated retry at the end of the phase. A budget-class
          // failure escalates into the architect's decomposed recovery ladder.
          const lastFailure = lastEncounterFailure || 'unknown failure';
          const { input: quarantineRetryInput, budgetClass } = buildQuarantineRetryInput(encounterInput, lastFailure);
          console.error(`[Pipeline] QUARANTINE: encounter ${sceneBlueprint.id} exhausted its ladder (${budgetClass ? 'budget-class' : 'content-class'} failure) — continuing the phase; escalated retry pass runs at phase end. Last error: ${lastFailure}`);
          context.emit({
            type: 'warning',
            phase: 'encounters',
            message: `Encounter ${sceneBlueprint.id} quarantined after ${maxEncounterAttempts} attempt(s) (${budgetClass ? 'budget' : 'content'} failure) — remaining scenes continue; escalated retry at phase end.`,
          });
          quarantinedEncounters.push({
            sceneId: sceneBlueprint.id,
            sceneName: sceneBlueprint.name,
            encounterType: sceneBlueprint.encounterType,
            lastFailure,
            budgetClass,
            diagnostics: lastEncounterFailureDiagnostics,
            retry: () => withTimeout(
              this.deps.encounterArchitect.execute(quarantineRetryInput, playerRelationships, allNpcInfos),
              PIPELINE_TIMEOUTS.encounterAgent,
              `EncounterArchitect.execute(${sceneBlueprint.id} quarantine-retry)`,
            ),
            register: async (result) => {
              const structure = result.data!;
              if (isEncounterNarrativelyHollow(structure)) {
                return 'quarantine retry returned a hollow encounter (no player-facing prose)';
              }
              const turnRealization = assessEncounterTurnRealization(sceneBlueprint, structure);
              if (!turnRealization.passed) {
                return `quarantine retry under-realized authored encounter turn(s): ${formatEncounterTurnRealizationFeedback(turnRealization)}`;
              }
              // Same no-boilerplate acceptance as the in-loop path: targeted
              // cost-field re-author for deterministic-injection hits, then a
              // hard refusal on any remaining template signature.
              let templateHits = scanEncounterBoilerplate(structure, sceneBlueprint);
              if (templateHits.some((hit) => hit.source === 'fallback')) {
                const repaired = await this.deps.encounterArchitect.reauthorFallbackCostFields(
                  structure,
                  { sceneName: sceneBlueprint.name, sceneDescription: sceneBlueprint.description },
                );
                if (repaired > 0) templateHits = scanEncounterBoilerplate(structure, sceneBlueprint);
              }
              if (templateHits.length > 0) {
                return `quarantine retry still contains ${templateHits.length} template-prose signature(s)`;
              }
              const quarantineOwnerBlockers = (await encounterRealizationFindings(structure))
                .filter((finding) => finding.blocking);
              if (quarantineOwnerBlockers.length > 0) {
                return `quarantine retry missed canonical owner-stage realization task(s): ${quarantineOwnerBlockers.map((finding) => `${finding.taskId}: ${finding.message}`).join('; ')}`;
              }
              const sanitizedStructure = scrubPreRevealIdentityReferences(
                structure,
                sceneBlueprint.identityScheduleContracts,
                episodeNumber ?? brief.episode.number,
              );
              plantEncounterInfoMarkers(sanitizedStructure);
              encounters.set(sceneBlueprint.id, sanitizedStructure);
              this.deps.captureEncounterTelemetry(result.metadata, sceneBlueprint.id);
              if (this.deps.incrementalValidator) {
                this.deps.trackEncounterFlagConsequences(sanitizedStructure);
              }
              // Quarantine recovery bypasses the normal encounterResult path;
              // record its incremental scene lock here so the episode lock can
              // distinguish a recovered encounter from a missing scene.
              if (this.deps.incrementalValidator && incrementalConfig.encounterValidation) {
                const encounterValidation = this.deps.incrementalValidator.validators.encounter.validateEncounter(sanitizedStructure);
                this.deps.recordSceneValidationResult({
                  sceneId: sceneBlueprint.id,
                  episodeNumber: brief.episode.number,
                  sceneName: sceneBlueprint.name,
                  encounter: encounterValidation,
                  overallPassed: encounterValidation.passed,
                  regenerationRequested: encounterValidation.passed ? 'none' : 'encounter',
                  validationTimeMs: 0,
                });
                context.emit({
                  type: 'incremental_validation',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} quarantine recovery: ${encounterValidation.passed ? 'PASSED' : 'ISSUES FOUND'} (${encounterValidation.beatCount} beats)`,
                  data: { passed: encounterValidation.passed, beatCount: encounterValidation.beatCount, issues: encounterValidation.issues },
                });
              }
              if (this.deps.generationPlan) {
                setSceneBeats(
                  this.deps.generationPlan,
                  episodeNumber ?? brief.episode.number,
                  sceneBlueprint.id,
                  sanitizedStructure.beats.length,
                );
                this.deps.emitPlanUpdate(`Encounter ${sceneBlueprint.id} recovered from quarantine`);
              }
              if (outputDirectory && episodeNumber) {
                await this.deps.saveResumeUnit(outputDirectory, encounterUnitId, encounterCheckpointPath, sanitizedStructure);
              }
              return null;
            },
          });
        }

        // Only register encounter + run validation if EncounterArchitect succeeded
        if (encounterResult?.success && encounterResult.data) {
          const encounterAdvisories = (await encounterRealizationFindings(encounterResult.data))
            .filter((finding) => !finding.blocking);
          if (encounterAdvisories.length > 0) {
            context.emit({
              type: 'warning',
              phase: 'encounters',
              message: `Encounter ${sceneBlueprint.id} has ${encounterAdvisories.length} advisory realization finding(s).`,
              data: { findings: encounterAdvisories },
            });
          }
          encounterResult.data = scrubPreRevealIdentityReferences(
            encounterResult.data,
            sceneBlueprint.identityScheduleContracts,
            episodeNumber ?? brief.episode.number,
          );
          plantEncounterInfoMarkers(encounterResult.data);
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
            
            if (encounterSceneContent || sceneBlueprint.isEncounter) {
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
              let templateHits = scanEncounterBoilerplate(encounters.get(sceneBlueprint.id), sceneBlueprint);
              if (templateHits.length > 0) {
                context.emit({
                  type: 'warning',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} contains ${templateHits.length} template-prose signature(s) — repair required (template prose must never ship)`,
                });
              }

              // TARGETED FIELD RE-AUTHOR (2026-07-06 encounter-cost postmortem):
              // deterministic-injection hits ('fallback' source — e.g. the cost
              // complication placeholder written when the LLM omitted
              // cost.visibleComplication) cannot be cleared by whole-encounter
              // regeneration: the injection recurs whenever the field is
              // omitted again, and the old feedback quoted registry labels the
              // LLM never authored. Author exactly those fields with one small
              // focused call BEFORE any regen decision, so the regen loop only
              // ever chases prose the LLM actually wrote.
              if (templateHits.some((hit) => hit.source === 'fallback')) {
                const repaired = await this.deps.encounterArchitect.reauthorFallbackCostFields(
                  encounters.get(sceneBlueprint.id),
                  { sceneName: sceneBlueprint.name, sceneDescription: sceneBlueprint.description },
                );
                if (repaired > 0) {
                  templateHits = scanEncounterBoilerplate(encounters.get(sceneBlueprint.id), sceneBlueprint);
                  context.emit({
                    type: 'debug',
                    phase: 'encounter',
                    message: `Encounter ${sceneBlueprint.id}: targeted cost-field re-author replaced ${repaired} deterministic placeholder(s) (${templateHits.length} signature(s) remain).`,
                  });
                }
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
                    ? `\n\nThe previous attempt contained GENERIC TEMPLATE PROSE that must be replaced with bespoke content grounded in this scene's stakes, setting, and characters:\n${describeBoilerplateHits(templateHits)}\nAuthor every player-facing string (setup, choices, outcomes, storylets) specifically for this encounter, and author every field marked MISSING FIELD above (e.g. cost.immediateEffect / cost.visibleComplication on terminal partialVictory outcomes) so no placeholder is injected.`
                    : '';
                  const turnGuidance = [
                    sceneBlueprint.turnContract?.centralTurn,
                    sceneBlueprint.signatureMoment,
                    ...(sceneBlueprint.requiredBeats ?? [])
                      .filter((beat) => beat.tier !== 'connective' && beat.tier !== 'seed')
                      .map((beat) => beat.mustDepict || beat.sourceTurn),
                  ]
                    .map((text) => typeof text === 'string' ? text.trim() : '')
                    .filter(Boolean);
                  const authoredTurnGuidance = turnGuidance.length > 0
                    ? `\n\nPreserve and fully stage these authored encounter turn obligation(s) in player-facing setupText, outcome narrativeText, nested nextSituation setupText, or storylet beat prose:\n- ${turnGuidance.join('\n- ')}`
                    : '';
                  const regenEncounterInput: EncounterArchitectInput = {
                    ...encounterInput,
                    storyContext: {
                      ...encounterInput.storyContext,
                      userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nCRITICAL ENCOUNTER FIXES REQUIRED:\n${issueDescriptions}\n\nEnsure the encounter has ${!encounterValidation.hasVictoryPath ? 'a clear victory path, ' : ''}${!encounterValidation.hasDefeatPath ? 'a clear defeat path, ' : ''}proper skill checks, and complete outcome branches.${collisionGuidance}${templateGuidance}${authoredTurnGuidance}`,
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
                    const regenTemplateHits = scanEncounterBoilerplate(regenEncounterResult.data, sceneBlueprint);
                    const regenTurnRealization = assessEncounterTurnRealization(sceneBlueprint, regenEncounterResult.data);

                    if (!regenTurnRealization.passed) {
                      context.emit({
                        type: 'warning',
                        phase: 'encounters',
                        message: `Encounter regeneration for ${sceneBlueprint.id} under-realized authored turn(s), keeping previous encounter. ${formatEncounterTurnRealizationFeedback(regenTurnRealization)}`,
                      });
                      continue;
                    }

                    if (regenValidation.passed ||
                        regenValidation.issues.length < encounterValidation.issues.length ||
                        regenCollisions.length < phase4Collisions.length ||
                        regenTemplateHits.length < templateHits.length) {
                      const sanitizedRegen = scrubPreRevealIdentityReferences(
                        regenEncounterResult.data,
                        sceneBlueprint.identityScheduleContracts,
                        episodeNumber ?? brief.episode.number,
                      );
                      plantEncounterInfoMarkers(sanitizedRegen);
                      encounters.set(sceneBlueprint.id, sanitizedRegen);
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

              // NO-BOILERPLATE MANDATE, two-tier policy (2026-07-06):
              // 'fallback'-source hits (deterministic-injection residue) get a
              // final targeted re-author pass — a regenerated encounter may
              // have introduced new omissions — and whatever remains DEFERS to
              // the final contract, where RouteContinuityValidator blocks it
              // as unsafe_fallback_prose with a wired repair route (the
              // encounter-cost handler + same-scene rewrite). Aborting the run
              // here for a string DETERMINISTIC code wrote was the 2026-07-06
              // failure: an unwinnable regen loop blaming the LLM for prose it
              // never authored.
              if (templateHits.some((hit) => hit.source === 'fallback')) {
                const repaired = await this.deps.encounterArchitect.reauthorFallbackCostFields(
                  encounters.get(sceneBlueprint.id),
                  { sceneName: sceneBlueprint.name, sceneDescription: sceneBlueprint.description },
                );
                if (repaired > 0) {
                  templateHits = scanEncounterBoilerplate(encounters.get(sceneBlueprint.id), sceneBlueprint);
                }
                const fallbackResidue = templateHits.filter((hit) => hit.source === 'fallback');
                if (fallbackResidue.length > 0) {
                  context.emit({
                    type: 'warning',
                    phase: 'encounters',
                    message: `Encounter ${sceneBlueprint.id}: ${fallbackResidue.length} deterministic fallback string(s) remain after the targeted re-author (${fallbackResidue.slice(0, 3).map((hit) => hit.label).join(', ')}) — deferred to the final contract's unsafe_fallback_prose repair loop.`,
                  });
                }
              }

              // 'template'-source hits (the EncounterArchitect's own
              // TEMPLATE_SIGNATURES surviving regeneration) mean the build
              // genuinely collapsed to deterministic filler — regeneration is
              // the only fix, so failing the episode here is correct and far
              // cheaper than the guaranteed run-level abort at the final
              // contract after every remaining episode had been paid for.
              // Gated (GATE_ENCOUNTER_TEMPLATE_ABORT, default ON); when off,
              // the collapse defers to encounter_template_collapse at the
              // final contract. Validation ISSUES without template prose keep
              // the existing ship-with-advisory behavior.
              const templateCollapseHits = templateHits.filter((hit) => hit.source === 'template');
              if (templateCollapseHits.length > 0) {
                if (isGateEnabled('GATE_ENCOUNTER_TEMPLATE_ABORT')) {
                  throw new PipelineError(
                    `Encounter ${sceneBlueprint.id} still contains template prose after regeneration (${templateCollapseHits.slice(0, 3).map(hit => `"${hit.snippet.slice(0, 60)}…"`).join(', ')}). Template prose must never ship — failing at generation time.`,
                    'encounters',
                    {
                      agent: 'EncounterArchitect',
                      context: {
                        sceneId: sceneBlueprint.id,
                        sceneName: sceneBlueprint.name,
                        encounterType: sceneBlueprint.encounterType,
                        failureKind: 'content',
                        templateSignatures: templateCollapseHits.map((hit) => hit.label),
                      },
                    }
                  );
                }
                context.emit({
                  type: 'warning',
                  phase: 'encounters',
                  message: `Encounter ${sceneBlueprint.id}: ${templateCollapseHits.length} template signature(s) remain with GATE_ENCOUNTER_TEMPLATE_ABORT off — deferred to the final contract's template-collapse gate.`,
                });
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
      const completedChoice = completedScene ? findChoiceSetForScene(choiceSets, completedScene) : undefined;
      const completedEncounter = encounters.get(sceneBlueprint.id);
      const ownerStageFindings: RealizationTaskGateFinding[] = [];
      for (const ownerStage of ['scene_writer', 'choice_author', 'encounter_architect'] as const) {
        const ownerTasks = (sceneBlueprint.realizationTasks ?? []).filter((task) => task.ownerStage === ownerStage);
        if (ownerTasks.length === 0) continue;
        const candidate = ownerStage === 'scene_writer'
          ? completedScene
          : ownerStage === 'choice_author'
            ? completedChoice
            : completedEncounter;
        if (!candidate) {
          if (ownerTasks.every((task) => !task.blocking)) continue;
          throw new PipelineError(
            `[OwnerStageNotExecuted] ${sceneBlueprint.id} has ${ownerTasks.length} blocking-capable ${ownerStage} task(s) but no owner artifact.`,
            ownerStage === 'choice_author' ? 'choices' : ownerStage === 'encounter_architect' ? 'encounters' : 'scenes',
            {
              agent: ownerStage === 'choice_author' ? 'ChoiceAuthor' : ownerStage === 'encounter_architect' ? 'EncounterArchitect' : 'SceneWriter',
              context: { sceneId: sceneBlueprint.id, taskIds: ownerTasks.map((task) => task.id) },
              failure: {
                code: 'owner_stage_not_executed',
                ownerStage,
                retryClass: ownerStage === 'choice_author'
                  ? 'repair_choice'
                  : ownerStage === 'encounter_architect'
                    ? 'repair_encounter_route'
                    : 'repair_scene_prose',
                issueCodes: ['OWNER_STAGE_NOT_EXECUTED'],
                artifactRefs: [],
                repairTarget: sceneBlueprint.id,
              },
            },
          );
        }
        const stageValidation = await this.validateNarrativeRealization({
          sceneId: sceneBlueprint.id,
          tasks: ownerTasks,
          sceneContent: completedScene,
          choiceSet: completedChoice,
          encounter: completedEncounter,
          mode: 'owner',
          currentStage: ownerStage,
          candidateHash: stableHash(candidate),
        });
        const stageFindings = stageValidation.findings;
        ownerStageFindings.push(...stageFindings);
        validationExecutionRecords.push(createValidatorExecutionRecord({
          policyId: `NarrativeRealizationTask@${ownerStage}`,
          validatorId: 'NarrativeRealizationTaskGate',
          lifecycle: 'episode-contract',
          role: 'primary',
          placement: 'scene',
          mode: 'enforce',
          passed: stageFindings.every((finding) => !finding.blocking),
          realizationReceipt: {
            sceneId: sceneBlueprint.id,
            ownerStage,
            candidateHash: stableHash(candidate),
            taskIds: ownerTasks.map((task) => task.id).sort(),
            findingFingerprints: stageFindings.map((finding) => finding.fingerprint).sort(),
            semanticVerdicts: stageValidation.semanticReceipt.semanticVerdicts,
          },
          issues: stageFindings.map((finding) => ({
            severity: finding.blocking ? 'error' : 'warning',
            code: finding.code,
            message: finding.message,
            metadata: {
              issueCode: finding.code,
              taskId: finding.taskId,
              contractId: finding.contractId,
              ownerStage: finding.ownerStage,
              sceneId: finding.sceneId,
              findingFingerprint: finding.fingerprint,
            },
          })),
        }));
      }
      const realizationFindings: RealizationTaskGateFinding[] = (await this.validateNarrativeRealization({
        sceneId: sceneBlueprint.id,
        tasks: sceneBlueprint.realizationTasks,
        sceneContent: completedScene,
        choiceSet: completedChoice,
        encounter: completedEncounter,
        mode: 'owner',
        candidateHash: stableHash({ completedScene, completedChoice, completedEncounter }),
      })).findings;
      const ownerFingerprints = ownerStageFindings.map((finding) => finding.fingerprint).sort();
      const regressionFingerprints = realizationFindings.map((finding) => finding.fingerprint).sort();
      if (stableHash(ownerFingerprints) !== stableHash(regressionFingerprints)) {
        throw new PipelineError(
          `[OwnerStageCoverageMismatch] ${sceneBlueprint.id} produced different owner-stage and scene-regression realization findings.`,
          'content',
          {
            agent: 'NarrativeRealizationTaskGate',
            context: { sceneId: sceneBlueprint.id, ownerFingerprints, regressionFingerprints },
            failure: {
              code: 'owner_stage_coverage_mismatch',
              ownerStage: 'scene_content',
              retryClass: 'none',
              issueCodes: ['OWNER_STAGE_COVERAGE_MISMATCH'],
              artifactRefs: [],
              repairTarget: sceneBlueprint.id,
            },
          },
        );
      }
      const realizationBlockers = realizationFindings.filter((finding) => finding.blocking);
      const realizationAdvisories = realizationFindings.filter((finding) => !finding.blocking);
      if ((sceneBlueprint.realizationTasks?.length ?? 0) > 0) {
        validationExecutionRecords.push(createValidatorExecutionRecord({
          policyId: 'NarrativeRealizationTask@scene-regression',
          validatorId: 'NarrativeRealizationTaskGate',
          lifecycle: 'episode-contract',
          role: 'regression-net',
          placement: 'scene',
          mode: 'audit',
          passed: realizationBlockers.length === 0,
          issues: realizationFindings.map((finding) => ({
            severity: finding.blocking ? 'error' : 'warning',
            code: finding.code,
            message: finding.message,
            metadata: {
              issueCode: finding.code,
              taskId: finding.taskId,
              contractId: finding.contractId,
              ownerStage: finding.ownerStage,
              repairHandler: sceneBlueprint.realizationTasks?.find((task) => task.id === finding.taskId)?.repairHandler,
              sceneId: finding.sceneId,
              outcomeTier: finding.outcomeTier,
              artifactPath: finding.field,
              missingEvidenceAtoms: finding.missingEvidenceAtoms,
              matchedForbiddenAtoms: finding.matchedForbiddenAtoms,
              findingFingerprint: finding.fingerprint,
            },
          })),
        }));
      }
      if (realizationAdvisories.length > 0) {
        context.emit({
          type: 'warning',
          phase: 'content',
          message: `Scene ${sceneBlueprint.id} has ${realizationAdvisories.length} advisory realization finding(s).`,
          data: { findings: realizationAdvisories },
        });
      }
      if (realizationBlockers.length > 0) {
        if (outputDirectory) {
          await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-realization-blockers.json`, {
            schemaVersion: 2,
            episodeNumber: densityEpisodeNumber,
            sceneId: sceneBlueprint.id,
            candidateHash: stableHash({ sceneContent: completedScene, choiceSet: completedChoice, encounter: completedEncounter }),
            candidate: { sceneContent: completedScene, choiceSet: completedChoice, encounter: completedEncounter },
            findings: realizationBlockers,
            assignedEventIds: sceneBlueprint.assignedEventIds ?? sceneBlueprint.narrativeEventIds ?? [],
            realizationTasks: sceneBlueprint.realizationTasks ?? [],
          });
        }
        const first = realizationBlockers[0];
        const ownerAgent = first.ownerStage === 'choice_author'
          ? 'ChoiceAuthor'
          : first.ownerStage === 'encounter_architect'
            ? 'EncounterArchitect'
            : 'SceneWriter';
        const ownerPhase = first.ownerStage === 'choice_author'
          ? 'choices'
          : first.ownerStage === 'encounter_architect'
            ? 'encounters'
            : 'scenes';
        throw new PipelineError(
          `[OwnerStageRealizationBlocker] ${sceneBlueprint.id} failed assigned realization task ${first.taskId}: ${first.message}`,
          ownerPhase,
          {
            agent: ownerAgent,
            context: {
              sceneId: sceneBlueprint.id,
              findings: realizationBlockers,
              retryBudget: 2,
            },
            failure: {
              code: first.ownerStage === 'scene_writer' ? 'prose_realization_failed' : 'owner_realization_failed',
              ownerStage: first.ownerStage,
              retryClass: first.ownerStage === 'choice_author'
                ? 'repair_choice'
                : first.ownerStage === 'encounter_architect'
                  ? 'repair_encounter_route'
                  : 'repair_scene_prose',
              issueCodes: realizationBlockers.map((finding) => finding.code),
              artifactRefs: outputDirectory
                ? [`episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-realization-blockers.json`]
                : [],
              repairTarget: first.taskId,
            },
          },
        );
      }
      const producerBlockers: ProducerBlockerFinding[] = [
        ...(completedScene ? validateSceneProducerOutput(sceneBlueprint.id, completedScene) : []),
        ...(completedChoice ? validateChoiceProducerOutput(sceneBlueprint.id, completedChoice) : []),
        ...(completedEncounter ? validateEncounterProducerOutput(sceneBlueprint.id, completedEncounter) : []),
      ];
      if (producerBlockers.length > 0) {
        if (outputDirectory) {
          await saveEarlyDiagnostic(outputDirectory, `episode-${densityEpisodeNumber}-scene-${sceneBlueprint.id}-producer-blockers.json`, {
            schemaVersion: 1,
            episodeNumber: densityEpisodeNumber,
            sceneId: sceneBlueprint.id,
            findings: producerBlockers,
          });
        }
        const summary = producerBlockers
          .slice(0, 5)
          .map((finding) => `${finding.ownerPhase}:${finding.fieldPath} (${finding.type})`)
          .join(' | ');
        throw new PipelineError(
          `[ProducerPhaseBlocker] ${sceneBlueprint.id} failed owner-phase validation before checkpoint: ${summary}.`,
          producerBlockers[0].ownerPhase === 'choice' ? 'choices' : producerBlockers[0].ownerPhase === 'encounter' ? 'encounters' : 'scenes',
          {
            agent: producerBlockers[0].ownerPhase === 'choice'
              ? 'ChoiceAuthor'
              : producerBlockers[0].ownerPhase === 'encounter'
                ? 'EncounterArchitect'
                : 'SceneWriter',
            context: {
              sceneId: sceneBlueprint.id,
              findings: producerBlockers,
              retryBudget: 1,
            },
          },
        );
      }
      if (completedScene && outputDirectory && episodeNumber) {
        await this.deps.saveResumeUnit(outputDirectory, sceneUnitId, sceneCheckpointPath, completedScene);
        if (completedChoice) {
          await this.deps.saveResumeUnit(outputDirectory, choiceUnitId, choiceCheckpointPath, completedChoice);
        }
        if (completedEncounter) {
          await this.deps.saveResumeUnit(outputDirectory, encounterUnitId, encounterCheckpointPath, completedEncounter);
        }
      }
      finalizedScenes.add(sceneBlueprint.id);
    }

    // === QUARANTINE RETRY PASS (P2) ===
    // Every non-quarantined scene is now generated and checkpointed. Give each
    // quarantined encounter one escalated retry (budget-class failures run the
    // architect's decomposed recovery ladder). Only unrecovered units fail the
    // phase — and resume then re-runs ONLY those units, not the whole episode.
    if (quarantinedEncounters.length > 0) {
      context.emit({
        type: 'warning',
        phase: 'encounters',
        message: `Quarantine retry pass: ${quarantinedEncounters.length} encounter unit(s) get an escalated retry (${quarantinedEncounters.map(u => `${u.sceneId}:${u.budgetClass ? 'budget' : 'content'}`).join(', ')})`,
      });
      const unrecovered = await runQuarantineRetryPass(quarantinedEncounters, (unit) => {
        context.emit({
          type: 'agent_complete',
          agent: 'EncounterArchitect',
          message: `Quarantined encounter ${unit.sceneId} recovered on the escalated retry (${unit.budgetClass ? 'decomposed budget-recovery ladder' : 'feedback retry'})`,
        });
      });
      if (unrecovered.length > 0) {
        throw new PipelineError(
          `Encounter generation failed for ${unrecovered.length} quarantined unit(s) after the escalated retry pass: ` +
          unrecovered.map(u => `${u.sceneId} (${u.error})`).join('; ') +
          `. All sibling content units are checkpointed — resume retries only the failed unit(s).`,
          'encounters',
          {
            agent: 'EncounterArchitect',
            context: {
              quarantinedUnits: unrecovered.map((u) => {
                const source = quarantinedEncounters.find((q) => q.sceneId === u.sceneId);
                return source?.diagnostics ? { ...u, diagnostics: source.diagnostics } : u;
              }),
              recoveredUnits: quarantinedEncounters.length - unrecovered.length,
              failureKind: 'content',
            },
          }
        );
      }
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

    // R8: the last scene's contract-load temperature must not leak into
    // later SceneWriter uses (final-contract regens, repair handlers).
    this.deps.sceneWriter.setContractLoadTemperature(undefined);

    await this.deps.runSceneCriticPass(sceneContents, characterBible);
    const twistMaterialization = materializeTwistPlan(
      this.deps.episodeTwistPlans.get(episodeNumber ?? brief.episode.number),
      sceneContents,
    );
    if (twistMaterialization.status === 'invalid') {
      context.emit({
        type: 'warning',
        phase: 'content',
        message: `Planned twist did not materialize: ${twistMaterialization.reason}`,
      });
    } else if (twistMaterialization.status === 'materialized') {
      context.emit({
        type: 'debug',
        phase: 'content',
        message: `Materialized planned twist markers on ${twistMaterialization.foreshadowBeatId} → ${twistMaterialization.twistBeatId}`,
      });
    }

    return { sceneContents, choiceSets, encounters, validationExecutionRecords };
  }

  /**
   * Encounter scenes carry their reader-facing prose in the encounter's own
   * phase beats — a scene-level scaffold beat is never real prose. Earlier
   * builds fabricated a "bridge" beat here from raw treatment text
   * ("The moment arrives before you can prepare for it: <treatment>") and it
   * shipped verbatim (bite-me 2026-07-03). Now: strip any such stale
   * placeholder from resumed checkpoints and leave the scene beat-less so
   * playback enters the encounter directly.
   */
  private ensureEncounterBridgeBeat(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
    const bridgeId = `${sceneBlueprint.id}-encounter-bridge`;
    const beats = content.beats ?? [];
    const withoutBridge = beats.filter((beat) => beat.id !== bridgeId);
    if (withoutBridge.length !== beats.length) {
      content.beats = withoutBridge;
      if (content.startingBeatId === bridgeId) {
        content.startingBeatId = withoutBridge[0]?.id ?? '';
      }
    }
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
    if (isPlanningRegisterText(coldOpen)) return;

    const alreadyAligned = (text?: string): boolean =>
      Boolean(text && text.includes(coldOpen));

    sceneBlueprint.keyBeats = Array.isArray(sceneBlueprint.keyBeats) ? sceneBlueprint.keyBeats : [];
    if (!sceneBlueprint.keyBeats.some((beat) => alreadyAligned(beat))) {
      sceneBlueprint.keyBeats.unshift(coldOpen);
    }
  }
}
