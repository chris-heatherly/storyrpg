// ========================================
// TREATMENT-FIDELITY VALIDATOR DISPATCH (Remediation §4 / GAP-D)
// ========================================
//
// The five §4 treatment-fidelity validators (AuthoredEpisodeConformance /
// EncounterAnchorContent / InformationLedgerSchedule / SignatureDevicePresence /
// SevenPointAnchorConformance) are registered in `validatorRegistry.ts` and gated
// by `treatmentFidelityGate.ts`, but nothing dispatched them — they were inert in
// a normal run. This module is the dispatch seam: `FullStoryPipeline`'s final-gate
// (`enforceFinalStoryContract`) calls {@link runFidelityValidators} in ONE line and
// feeds the returned `fidelityFindings` + `treatmentSourced` straight into
// `FinalStoryContractValidator.validate`, where §4.6 keeps treatment-fidelity
// errors blocking (vs. the advisory QA-prose downgrade).
//
// Each validator runs ONLY when its rollout flag is enabled
// (`isFidelityGateEnabled`), so with every flag unset this is byte-identical to
// today (returns no findings). The producers of every input already exist:
//   - authored episodes / anchors: `analysis.episodeBreakdown[].treatmentGuidance`
//     + `analysis.treatmentSeasonGuidance` (deterministic parser output);
//   - the season SCENE plan (requiredBeats / signatureMoment / encounter anchors):
//     `seasonPlan.scenePlan`;
//   - the authored INFO ledger: `seasonPlan.informationLedger`;
//   - the generated `story`.
//
// Pure-ish: no LLM calls, no wall-clock, no randomness. The only side-effect-ish
// read is each validator's gate flag (a `process.env` read inside the gate).

import type { Story } from '../../types/story';
import type { SeasonPlan, InformationLedgerEntry } from '../../types/seasonPlan';
import type { SeasonScenePlan, PlannedScene } from '../../types/scenePlan';
import type {
  SourceMaterialAnalysis,
  TreatmentEpisodeGuidance,
  SevenPointBeat,
} from '../../types/sourceAnalysis';
import type { ExtractedTreatment } from '../utils/treatmentExtraction';
import type { ValidationIssue } from './BaseValidator';

import {
  TREATMENT_FIDELITY_GATE_FLAGS,
  isFidelityGateEnabled,
  type TreatmentFidelityGateFlag,
} from './treatmentFidelityGate';
import { AuthoredEpisodeConformanceValidator } from './AuthoredEpisodeConformanceValidator';
import { EncounterAnchorContentValidator } from './EncounterAnchorContentValidator';
import { InformationLedgerScheduleValidator } from './InformationLedgerScheduleValidator';
import { SignatureDevicePresenceValidator } from './SignatureDevicePresenceValidator';
import { EncounterSetPieceDepthValidator } from './EncounterSetPieceDepthValidator';
import { RequiredBeatRealizationValidator } from './RequiredBeatRealizationValidator';
import { RelationshipPacingValidator } from './RelationshipPacingValidator';
import { NarrativeMechanicPressureValidator } from './NarrativeMechanicPressureValidator';
import { TreatmentFieldUtilizationValidator } from './TreatmentFieldUtilizationValidator';
import { SeasonPromiseRealizationValidator } from './SeasonPromiseRealizationValidator';
import { CharacterTreatmentRealizationValidator } from './CharacterTreatmentRealizationValidator';
import { NarrativeFailureModeValidator } from './NarrativeFailureModeValidator';
import { SceneTransitionContinuityValidator } from './SceneTransitionContinuityValidator';
import { SceneTurnRealizationValidator } from './SceneTurnRealizationValidator';
import { CharacterIntroductionValidator } from './CharacterIntroductionValidator';
import { isGateEnabled } from '../remediation/gateDefaults';
import { isGateEnabledAt } from '../remediation/gateRegistry';
import {
  SevenPointAnchorConformanceValidator,
  seasonPlanToAnchorConformanceInput,
} from './SevenPointAnchorConformanceValidator';

/** One §4 fidelity finding in the shape `FinalStoryContractInput.fidelityFindings` expects. */
export interface FidelityFinding {
  validator: string;
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
  episodeNumber?: number;
  sceneId?: string;
}

export interface RunFidelityValidatorsResult {
  /** All findings emitted by the enabled §4 validators (error/warning only). */
  fidelityFindings: FidelityFinding[];
  /**
   * Whether this run's source-of-record is an authored treatment. §4.6: when true,
   * `FinalStoryContractValidator` keeps fidelity errors BLOCKING instead of
   * downgrading them to advisory warnings.
   */
  treatmentSourced: boolean;
}

export interface RunFidelityValidatorsInput {
  story: Story;
  /** The final season plan (carries `scenePlan`, `informationLedger`, episodes). */
  seasonPlan?: SeasonPlan;
  /** The source analysis (authored episode titles, anchors, treatment metadata). */
  sourceAnalysis?: SourceMaterialAnalysis;
  /** Which generated scope this final-contract pass is validating. */
  scope?: FidelityValidationScope;
}

const EMPTY: RunFidelityValidatorsResult = { fidelityFindings: [], treatmentSourced: false };

export type FidelityValidationScopeMode = 'episode-incremental' | 'generated-slice' | 'full-season';

export interface FidelityValidationScope {
  mode: FidelityValidationScopeMode;
  generatedEpisodeNumbers?: number[];
  requestedEpisodeNumbers?: number[];
  generatedThroughEpisode?: number;
}

function uniqueNumbers(values: Array<number | undefined> | undefined): number[] {
  return [...new Set((values ?? []).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))].sort((a, b) => a - b);
}

function storyEpisodeNumbers(story: Story): number[] {
  return uniqueNumbers((story.episodes ?? []).map((episode) => episode.number));
}

function activeEpisodesFor(input: RunFidelityValidatorsInput): Set<number> | undefined {
  if (!input.scope || input.scope.mode === 'full-season') return undefined;
  const explicit = uniqueNumbers(input.scope.generatedEpisodeNumbers);
  const requested = uniqueNumbers(input.scope.requestedEpisodeNumbers);
  const fromStory = storyEpisodeNumbers(input.story);
  const active = explicit.length > 0 ? explicit : requested.length > 0 ? requested : fromStory;
  return active.length > 0 ? new Set(active) : undefined;
}

function scopedEpisodeArray<T>(items: T[] | undefined, active: Set<number> | undefined, getEpisode: (item: T) => number | undefined): T[] | undefined {
  if (!items || !active) return items;
  return items.filter((item) => {
    const episodeNumber = getEpisode(item);
    return typeof episodeNumber !== 'number' || active.has(episodeNumber);
  });
}

type EpisodeTargeted = {
  episodeNumber?: number;
  targetEpisodeNumber?: number;
  targetEpisodeNumbers?: number[];
  targetSceneIds?: string[];
};

function scopedContracts<T extends EpisodeTargeted>(
  items: T[] | undefined,
  active: Set<number> | undefined,
  activeSceneIds?: Set<string>,
): T[] | undefined {
  if (!items || !active) return items;
  return items.filter((item) => {
    const episodeTargets = uniqueNumbers([
      item.episodeNumber,
      item.targetEpisodeNumber,
      ...(item.targetEpisodeNumbers ?? []),
    ]);
    if (episodeTargets.length > 0) return episodeTargets.some((episodeNumber) => active.has(episodeNumber));
    const sceneTargets = item.targetSceneIds ?? [];
    if (sceneTargets.length > 0 && activeSceneIds) return sceneTargets.some((sceneId) => activeSceneIds.has(sceneId));
    return true;
  });
}

function scopedPlannedScene(scene: PlannedScene, active: Set<number> | undefined, activeSceneIds: Set<string>): PlannedScene {
  if (!active) return scene;
  return {
    ...scene,
    requiredBeats: scene.requiredBeats,
    relationshipPacing: scene.relationshipPacing,
    mechanicPressure: scene.mechanicPressure,
    authoredTreatmentFields: scopedContracts(scene.authoredTreatmentFields, active, activeSceneIds),
    seasonPromiseContracts: scopedContracts(scene.seasonPromiseContracts, active, activeSceneIds),
    stakesArchitectureContracts: scopedContracts(scene.stakesArchitectureContracts, active, activeSceneIds),
    branchConsequenceContracts: scopedContracts(scene.branchConsequenceContracts, active, activeSceneIds),
    endingRealizationContracts: scopedContracts(scene.endingRealizationContracts, active, activeSceneIds),
    failureModeAuditContracts: scopedContracts(scene.failureModeAuditContracts, active, activeSceneIds),
    sevenPointBeatContracts: scopedContracts(scene.sevenPointBeatContracts, active, activeSceneIds),
    arcPressureContracts: scopedContracts(scene.arcPressureContracts, active, activeSceneIds),
    characterTreatmentContracts: scopedContracts(scene.characterTreatmentContracts, active, activeSceneIds),
    worldTreatmentContracts: scopedContracts(scene.worldTreatmentContracts, active, activeSceneIds),
  };
}

function scopedScenePlan(scenePlan: SeasonScenePlan | undefined, active: Set<number> | undefined): SeasonScenePlan | undefined {
  if (!scenePlan || !active) return scenePlan;
  const scenes = (scenePlan.scenes ?? []).filter((scene) => active.has(scene.episodeNumber));
  const activeSceneIds = new Set(scenes.map((scene) => scene.id));
  const scopedScenes = scenes.map((scene) => scopedPlannedScene(scene, active, activeSceneIds));
  const byEpisode: Record<number, string[]> = {};
  for (const [key, ids] of Object.entries(scenePlan.byEpisode ?? {})) {
    const episodeNumber = Number(key);
    if (!active.has(episodeNumber)) continue;
    byEpisode[episodeNumber] = ids.filter((id) => activeSceneIds.has(id));
  }
  return {
    ...scenePlan,
    scenes: scopedScenes,
    byEpisode,
    setupPayoffEdges: (scenePlan.setupPayoffEdges ?? []).filter((edge) => activeSceneIds.has(edge.from) && activeSceneIds.has(edge.to)),
    authoredTreatmentFields: scopedContracts(scenePlan.authoredTreatmentFields, active, activeSceneIds),
    seasonPromiseContracts: scopedContracts(scenePlan.seasonPromiseContracts, active, activeSceneIds),
    stakesArchitectureContracts: scopedContracts(scenePlan.stakesArchitectureContracts, active, activeSceneIds),
    branchConsequenceContracts: scopedContracts(scenePlan.branchConsequenceContracts, active, activeSceneIds),
    endingRealizationContracts: scopedContracts(scenePlan.endingRealizationContracts, active, activeSceneIds),
    failureModeAuditContracts: scopedContracts(scenePlan.failureModeAuditContracts, active, activeSceneIds),
    sevenPointBeatContracts: scopedContracts(scenePlan.sevenPointBeatContracts, active, activeSceneIds),
    arcPressureContracts: scopedContracts(scenePlan.arcPressureContracts, active, activeSceneIds),
    characterTreatmentContracts: scopedContracts(scenePlan.characterTreatmentContracts, active, activeSceneIds),
    worldTreatmentContracts: scopedContracts(scenePlan.worldTreatmentContracts, active, activeSceneIds),
  };
}

function entryTouchesActiveEpisode(entry: InformationLedgerEntry, active: Set<number> | undefined): boolean {
  if (!active) return true;
  return uniqueNumbers([
    entry.introducedEpisode,
    entry.plannedRevealEpisode,
    entry.plannedPayoffEpisode,
    ...(entry.setupTouchEpisodes ?? []),
    ...(entry.setupTouchDetails ?? []).map((touch) => touch.episodeNumber),
  ]).some((episodeNumber) => active.has(episodeNumber));
}

function scopeSeasonPlan(seasonPlan: SeasonPlan | undefined, active: Set<number> | undefined): SeasonPlan | undefined {
  if (!seasonPlan || !active) return seasonPlan;
  const scenePlan = scopedScenePlan(seasonPlan.scenePlan, active);
  const activeSceneIds = new Set((scenePlan?.scenes ?? []).map((scene) => scene.id));
  return {
    ...seasonPlan,
    episodes: scopedEpisodeArray(seasonPlan.episodes, active, (episode) => episode.episodeNumber) ?? [],
    scenePlan,
    informationLedger: (seasonPlan.informationLedger ?? []).filter((entry) => entryTouchesActiveEpisode(entry, active)),
    choiceMoments: (seasonPlan.choiceMoments ?? []).filter((moment) => active.has(moment.episode) || active.has(moment.paysOffEpisode ?? -1)),
    seasonPromiseContracts: scopedContracts(seasonPlan.seasonPromiseContracts, active, activeSceneIds),
    stakesArchitectureContracts: scopedContracts(seasonPlan.stakesArchitectureContracts, active, activeSceneIds),
    sevenPointBeatContracts: scopedContracts(seasonPlan.sevenPointBeatContracts, active, activeSceneIds),
    arcPressureContracts: scopedContracts(seasonPlan.arcPressureContracts, active, activeSceneIds),
    branchConsequenceContracts: scopedContracts(seasonPlan.branchConsequenceContracts, active, activeSceneIds),
    endingRealizationContracts: scopedContracts(seasonPlan.endingRealizationContracts, active, activeSceneIds),
    failureModeAuditContracts: scopedContracts(seasonPlan.failureModeAuditContracts, active, activeSceneIds),
    characterTreatmentContracts: scopedContracts(seasonPlan.characterTreatmentContracts, active, activeSceneIds),
    worldTreatmentContracts: scopedContracts(seasonPlan.worldTreatmentContracts, active, activeSceneIds),
  };
}

function scopeSourceAnalysis(analysis: SourceMaterialAnalysis | undefined, active: Set<number> | undefined): SourceMaterialAnalysis | undefined {
  if (!analysis || !active) return analysis;
  return {
    ...analysis,
    episodeBreakdown: scopedEpisodeArray(analysis.episodeBreakdown, active, (episode) => episode.episodeNumber) ?? [],
    stakesArchitectureContracts: scopedContracts(analysis.stakesArchitectureContracts, active),
    sevenPointBeatContracts: scopedContracts(analysis.sevenPointBeatContracts, active),
    arcPressureContracts: scopedContracts(analysis.arcPressureContracts, active),
    branchConsequenceContracts: scopedContracts(analysis.branchConsequenceContracts, active),
    endingRealizationContracts: scopedContracts(analysis.endingRealizationContracts, active),
    failureModeAuditContracts: scopedContracts(analysis.failureModeAuditContracts, active),
    characterTreatmentContracts: scopedContracts(analysis.characterTreatmentContracts, active),
    worldTreatmentContracts: scopedContracts(analysis.worldTreatmentContracts, active),
  } as SourceMaterialAnalysis;
}

function scopedFidelityInput(input: RunFidelityValidatorsInput): RunFidelityValidatorsInput {
  const active = activeEpisodesFor(input);
  if (!active) return input;
  return {
    ...input,
    seasonPlan: scopeSeasonPlan(input.seasonPlan, active),
    sourceAnalysis: scopeSourceAnalysis(input.sourceAnalysis, active),
  };
}

/**
 * Reconstruct the `ExtractedTreatment`-shaped input the
 * AuthoredEpisodeConformanceValidator needs from the source analysis. The deterministic
 * parser already wrote per-episode `treatmentGuidance` (with `authoredTitle`) onto each
 * `episodeBreakdown` entry and `treatmentSeasonGuidance` (with `beatEpisodeAnchors`) on
 * the analysis — this just keys the episodes by number.
 */
function treatmentFromAnalysis(
  analysis: SourceMaterialAnalysis,
): Pick<ExtractedTreatment, 'episodes' | 'seasonGuidance'> {
  const episodes: Record<number, TreatmentEpisodeGuidance> = {};
  for (const ep of analysis.episodeBreakdown || []) {
    if (typeof ep.episodeNumber !== 'number') continue;
    const guidance = ep.treatmentGuidance;
    if (guidance) episodes[ep.episodeNumber] = guidance;
  }
  return { episodes, seasonGuidance: analysis.treatmentSeasonGuidance };
}

type AuthoredTreatmentContractSource = {
  characterTreatmentContracts?: unknown[];
  worldTreatmentContracts?: unknown[];
  failureModeAuditContracts?: unknown[];
  endingRealizationContracts?: unknown[];
  branchConsequenceContracts?: unknown[];
};

function hasAuthoredTreatmentContractArrays(source: AuthoredTreatmentContractSource | undefined): boolean {
  if (!source) return false;
  return [
    source.characterTreatmentContracts,
    source.worldTreatmentContracts,
    source.failureModeAuditContracts,
    source.endingRealizationContracts,
    source.branchConsequenceContracts,
  ].some((contracts) => Array.isArray(contracts) && contracts.length > 0);
}

/** True when the run was sourced from an authored treatment (drives §4.6 blocking). */
function isTreatmentSourced(
  analysis: SourceMaterialAnalysis | undefined,
  seasonPlan?: SeasonPlan,
): boolean {
  if (!analysis) return hasAuthoredTreatmentContractArrays(seasonPlan);
  if (analysis.sourceFormat === 'story_treatment') return true;
  if (analysis.treatmentMetadata?.detected) return true;
  // Defensive: any parsed authored episode guidance also implies a treatment source.
  if (Object.values(analysis.treatmentSeasonGuidance ?? {}).length > 0) return true;
  // Some UX-driven document runs arrive as `sourceFormat: "prompt"` after the
  // treatment parser has already materialized authored-treatment contracts onto
  // the analysis/season plan. Those contracts are the source-of-record even when
  // the coarse format tag is stale, so they must keep §4.6 fail-closed.
  return hasAuthoredTreatmentContractArrays(analysis) || hasAuthoredTreatmentContractArrays(seasonPlan);
}

/**
 * Extract the scene reference a §4 validator encoded in its issue `location`
 * (`requiredBeat:ep2:s2-1:beat-1`, `scenePlan:ep1:treatment-enc-1-1`, …). The
 * downstream judge-confirmation and scene-prose repair handlers are keyed on
 * `sceneId`/`episodeNumber` — without these fields a finding can only abort,
 * never be confirmed or repaired.
 */
const LOCATION_SCENE_RE = /:ep(\d+):([^:]+)/;
function locationSceneRef(location?: string): { episodeNumber?: number; sceneId?: string } {
  const m = location ? LOCATION_SCENE_RE.exec(location) : null;
  if (!m) return {};
  return { episodeNumber: Number(m[1]), sceneId: m[2] };
}

/**
 * Map a validator's `ValidationIssue`s (error/warning only) to fidelity findings.
 * `downgradeToWarning` forces every finding to `warning` severity — used to keep a
 * validator VISIBLE (its findings surface in the contract report) while its gate is
 * off, so it advises without hard-blocking.
 */
function toFindings(validator: string, issues: ValidationIssue[], downgradeToWarning = false): FidelityFinding[] {
  const out: FidelityFinding[] = [];
  for (const issue of issues) {
    if (issue.severity !== 'error' && issue.severity !== 'warning') continue;
    out.push({
      validator,
      severity: downgradeToWarning ? 'warning' : issue.severity,
      message: issue.message,
      suggestion: issue.suggestion,
      ...locationSceneRef(issue.location),
    });
  }
  return out;
}

/**
 * Dispatch the five §4 treatment-fidelity validators against the final story and the
 * authored plan, collecting their findings. Each validator runs ONLY when its rollout
 * flag is enabled; with all flags off this returns no findings (default-off, no regression).
 *
 * Defensive: a single validator throwing must not abort the final gate — its failure is
 * swallowed (the gate's own contract checks still run), so a malformed input degrades to
 * "this validator produced no findings" rather than crashing the run.
 */
/** Map each §4 validator to its rollout flag (for shadow attribution). */
export const FIDELITY_VALIDATOR_FLAGS: Record<string, string> = {
  AuthoredEpisodeConformanceValidator: TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance,
  EncounterAnchorContentValidator: TREATMENT_FIDELITY_GATE_FLAGS.encounterAnchorContent,
  InformationLedgerScheduleValidator: TREATMENT_FIDELITY_GATE_FLAGS.informationLedgerSchedule,
  SignatureDevicePresenceValidator: TREATMENT_FIDELITY_GATE_FLAGS.signatureDevicePresence,
  SevenPointAnchorConformanceValidator: TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance,
  SceneTransitionContinuityValidator: 'GATE_SCENE_TRANSITION_CONTINUITY',
  SceneTurnRealizationValidator: 'GATE_SCENE_TURN_REALIZATION',
  RelationshipPacingValidator: 'GATE_RELATIONSHIP_PACING',
  NarrativeMechanicPressureValidator: 'GATE_NARRATIVE_MECHANIC_PRESSURE',
  TreatmentFieldUtilizationValidator: 'GATE_TREATMENT_FIELD_UTILIZATION',
  SeasonPromiseRealizationValidator: 'GATE_SEASON_PROMISE_REALIZATION',
  CharacterTreatmentRealizationValidator: 'GATE_CHARACTER_TREATMENT_REALIZATION',
  NarrativeFailureModeValidator: 'GATE_FAILURE_MODE_AUDIT_REALIZATION',
};

/**
 * Run the five §4 validators, gating each by the injected `isEnabled` predicate.
 * `runFidelityValidators` passes the real gate; the shadow path passes `() => true`.
 */
function collectFidelityFindings(
  input: RunFidelityValidatorsInput,
  isEnabled: (flag: TreatmentFidelityGateFlag) => boolean,
  treatmentSourced: boolean,
): FidelityFinding[] {
  const scopedInput = scopedFidelityInput(input);
  const { story, seasonPlan, sourceAnalysis } = scopedInput;
  const unscopedSeasonPlan = input.seasonPlan;
  const unscopedSourceAnalysis = input.sourceAnalysis;
  const incrementalEpisodeSeal = input.scope?.mode === 'episode-incremental';
  const findings: FidelityFinding[] = [];

  const beatEpisodeAnchors = unscopedSourceAnalysis?.treatmentSeasonGuidance?.beatEpisodeAnchors as
    | Partial<Record<SevenPointBeat, number>>
    | undefined;
  const scenePlan = seasonPlan?.scenePlan;

  const guard = (fn: () => FidelityFinding[]): void => {
    try {
      findings.push(...fn());
    } catch {
      // A validator failure must not abort the final gate (§4 validators are advisory
      // backstops layered on top of the contract's own checks). Degrade to no findings.
    }
  };

  // 4.1 — authored episode identity (count/order/title/anchor). Needs the treatment + plan.
  if (!incrementalEpisodeSeal && isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance) && unscopedSourceAnalysis && unscopedSeasonPlan) {
    guard(() => {
      const result = new AuthoredEpisodeConformanceValidator().validate({
        treatment: treatmentFromAnalysis(unscopedSourceAnalysis),
        seasonPlan: unscopedSeasonPlan,
      });
      return toFindings('AuthoredEpisodeConformanceValidator', result.issues);
    });
  }

  // 4.2 — encounter anchors depict their authored required beats. Needs the scene plan.
  if (isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.encounterAnchorContent) && scenePlan) {
    guard(() => {
      const result = new EncounterAnchorContentValidator().validate(story, { scenePlan });
      return toFindings('EncounterAnchorContentValidator', result.issues);
    });
  }

  // 4.3 — authored INFO setup/reveal land on their scheduled episodes. VISIBLE-ALWAYS on
  // treatment runs: the schedule check always runs so its findings are never hidden, but
  // it only HARD-BLOCKS when its gate is on. While the gate is off (its generative half —
  // the info-reveal emitter, Steps 1-3 — is still being built) the findings are downgraded
  // to advisory warnings: visible in the contract report, non-blocking.
  if (seasonPlan && treatmentSourced) {
    const infoGateOn = isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.informationLedgerSchedule);
    guard(() => {
      const ledger = seasonPlan.informationLedger as InformationLedgerEntry[] | undefined;
      const result = new InformationLedgerScheduleValidator().validate(ledger, story);
      return toFindings('InformationLedgerScheduleValidator', result.issues, !infoGateOn);
    });
  }

  // 4.4 — each signature device appears in prose, never inverted. Needs the scene plan.
  if (isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.signatureDevicePresence) && scenePlan) {
    guard(() => {
      const result = new SignatureDevicePresenceValidator().validate({
        plan: scenePlan,
        story,
        // G10: under strict mode a summarized-away concrete signature blocks (only true
        // meta-narration notes stay advisory). Default-OFF pending a live validation run.
        strictPresence: isGateEnabled('GATE_SIGNATURE_PRESENCE_STRICT'),
      });
      return toFindings('SignatureDevicePresenceValidator', result.issues);
    });
  }

  // G10 — a sustained set-piece encounter must keep escalating structure, not collapse
  // to a single decision + summary. Gated separately (GATE_ENCOUNTER_SETPIECE_DEPTH).
  if (isGateEnabled('GATE_ENCOUNTER_SETPIECE_DEPTH') && scenePlan) {
    guard(() => {
      const result = new EncounterSetPieceDepthValidator().validate({ story, plan: scenePlan });
      return toFindings('EncounterSetPieceDepthValidator', result.issues);
    });
  }

  // G10 — an `authored`-tier required beat on a STANDARD scene must be dramatized in its
  // scene's prose. Fills the gap between SignatureDevicePresence (signature-tier only) and
  // EncounterAnchorContent (encounter scenes only) — the Endsong ep1 s1-6 key-reveal hole.
  // Gated separately (GATE_REQUIRED_BEAT_REALIZATION, default-OFF).
  if (isGateEnabled('GATE_REQUIRED_BEAT_REALIZATION') && scenePlan) {
    guard(() => {
      const result = new RequiredBeatRealizationValidator().validate({ story, plan: scenePlan });
      return toFindings('RequiredBeatRealizationValidator', result.issues);
    });
  }

  // 2026-06-09 — unacknowledged time/place jump between adjacent scenes: the planned
  // location/timeOfDay changed (Scene.timeline) but the arriving scene has no
  // transitionIn and no transition language in its opening prose. Inert on stories
  // without timeline metadata. Gated separately (GATE_SCENE_TRANSITION_CONTINUITY).
  if (isGateEnabled('GATE_SCENE_TRANSITION_CONTINUITY')) {
    guard(() => {
      const result = new SceneTransitionContinuityValidator().validate({ story, scenePlan });
      return toFindings('SceneTransitionContinuityValidator', result.issues);
    });
  }

  // Turn-centered scene realization: every scene with a generated turn contract must
  // show setup/pre-turn pressure, the central turn, and aftermath/handoff. Treatment
  // central-turn misses are blocking; non-treatment misses remain warning unless the
  // validator identifies structural risk.
  if (isGateEnabled('GATE_SCENE_TURN_REALIZATION')) {
    guard(() => {
      const result = new SceneTurnRealizationValidator().validate({ story, scenePlan, treatmentSourced });
      return toFindings('SceneTurnRealizationValidator', result.issues);
    });
  }

  // Relationship pacing: instant chemistry is allowed, but friendship, trust,
  // intimacy, and group membership must be earned by prior scenes, visible
  // behavior, and relationship consequences.
  if (isGateEnabled('GATE_RELATIONSHIP_PACING')) {
    guard(() => {
      const result = new RelationshipPacingValidator().validate({ story, scenePlan, treatmentSourced });
      return toFindings('RelationshipPacingValidator', result.issues);
    });
  }

  // Narrative mechanic pressure: hidden state must originate in on-page events,
  // leave visible residue, and be spent as earned story permission.
  if (!incrementalEpisodeSeal && isGateEnabled('GATE_NARRATIVE_MECHANIC_PRESSURE')) {
    guard(() => {
      const result = new NarrativeMechanicPressureValidator().validate({ story, scenePlan, treatmentSourced });
      return toFindings('NarrativeMechanicPressureValidator', result.issues);
    });
  }

  // Treatment field utilization: every parsed authored field (pressure lanes,
  // encounter shape, stakes/theme/lie pressure, information/consequence seeds,
  // ending turnout, and cliffhanger pressure) must be consumed into a concrete
  // planning artifact and realized fiction-first in the final story.
  if (!incrementalEpisodeSeal && isGateEnabled('GATE_TREATMENT_FIELD_UTILIZATION') && treatmentSourced && sourceAnalysis) {
    guard(() => {
      const result = new TreatmentFieldUtilizationValidator().validate({
        story,
        seasonPlan,
        sourceAnalysis,
        treatmentSourced,
        phase: 'final',
      });
      return toFindings('TreatmentFieldUtilizationValidator', result.issues);
    });
  }

  // Season promise realization: top-level treatment promises (genre/tone
  // progression, logline engine, core fantasy, audience/premise promise, theme
  // question, and inaction pressure) must be consumed by planning and show up
  // as staged story material, not metadata-only guidance.
  if (isGateEnabled('GATE_SEASON_PROMISE_REALIZATION')) {
    guard(() => {
      const result = new SeasonPromiseRealizationValidator().validate({
        story,
        seasonPlan,
        sourceAnalysis,
        treatmentSourced,
        phase: 'final',
      });
      return toFindings('SeasonPromiseRealizationValidator', result.issues);
    });
  }

  // Protagonist treatment realization: authored protagonist fields (identity,
  // role facts, Want/Need/Lie/Wound/Truth, starting identity, pressure points,
  // climax choice, end states, visual identity) must be consumed into plan
  // artifacts and realized fiction-first.
  if (isGateEnabled('GATE_CHARACTER_TREATMENT_REALIZATION')) {
    guard(() => {
      const result = new CharacterTreatmentRealizationValidator().validate({
        story,
        seasonPlan,
        sourceAnalysis,
        treatmentSourced,
        phase: 'final',
      });
      return toFindings('CharacterTreatmentRealizationValidator', result.issues);
    });
  }

  // Failure-mode audit realization: Section 15 "avoided"/"watch item" rows are
  // binding only when they name concrete story mechanisms. The validator keeps
  // its generic narrative diagnostics advisory elsewhere; this route enforces the
  // authored audit contracts against the generated story.
  if (isGateEnabled('GATE_FAILURE_MODE_AUDIT_REALIZATION') && treatmentSourced) {
    const failureModeAuditContracts = seasonPlan?.failureModeAuditContracts ?? sourceAnalysis?.failureModeAuditContracts ?? [];
    if (failureModeAuditContracts.length > 0) {
      guard(() => {
        const result = new NarrativeFailureModeValidator().validate({
          story,
          seasonPlan,
          failureModeAuditContracts,
        });
        return toFindings('NarrativeFailureModeValidator', result.issues);
      });
    }
  }

  // 2026-06-09 — characters surfacing without on-page introduction: a roster NPC
  // name-dropped in prose before any scene casts them, or cast in a scene whose prose
  // never names them. Gated separately (GATE_CHARACTER_INTRODUCTION).
  if (isGateEnabled('GATE_CHARACTER_INTRODUCTION')) {
    guard(() => {
      const result = new CharacterIntroductionValidator().validate({
        story,
        characterIntroductions: seasonPlan?.characterIntroductions,
      });
      return toFindings('CharacterIntroductionValidator', result.issues);
    });
  }

  // 4.5 — each authored beat→episode anchor is honored in the final season.
  if (!incrementalEpisodeSeal && isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance) && unscopedSeasonPlan && beatEpisodeAnchors) {
    guard(() => {
      const result = new SevenPointAnchorConformanceValidator().validate(
        seasonPlanToAnchorConformanceInput(unscopedSeasonPlan, beatEpisodeAnchors),
      );
      return toFindings('SevenPointAnchorConformanceValidator', result.issues);
    });
  }

  return findings;
}

export function runFidelityValidators(input: RunFidelityValidatorsInput): RunFidelityValidatorsResult {
  const treatmentSourced = isTreatmentSourced(input.sourceAnalysis, input.seasonPlan);
  const findings = collectFidelityFindings(input, isFidelityGateEnabled, treatmentSourced);
  if (findings.length === 0 && !treatmentSourced) return EMPTY;
  return { fidelityFindings: findings, treatmentSourced };
}

/**
 * SHADOW: run ALL five §4 validators regardless of their flag, for off→on promotion
 * data. Never feeds blocking findings — callers record the counts to the shadow ledger.
 */
export function runFidelityValidatorsShadow(input: RunFidelityValidatorsInput): FidelityFinding[] {
  return collectFidelityFindings(input, () => true, true);
}

// ========================================
// Plan-time placement (WS1, AGENT_ARCHITECTURE_PLAN_2026-06-12)
// ========================================

export interface PlanTimeFidelityResult {
  /** All findings from the plan-checkable validators (errors + warnings). */
  findings: FidelityFinding[];
  /** Error-severity findings that should fail the run BEFORE generation. */
  blockingErrors: FidelityFinding[];
  treatmentSourced: boolean;
}

const EMPTY_PLAN_TIME: PlanTimeFidelityResult = {
  findings: [],
  blockingErrors: [],
  treatmentSourced: false,
};

/**
 * The two §4 validators whose inputs are plan-vs-treatment only (no generated
 * story): AuthoredEpisodeConformance (episode count/order/title) and
 * SevenPointAnchorConformance (beat→episode anchors). Both previously gated
 * ONLY at the season-final contract, where a deterministic plan mismatch
 * killed the whole run after the full generation spend (median 73 min in the
 * 2026-06-11 audit). This check runs the SAME validators at `plan` placement —
 * before any prose is generated — so the same mismatch fails in milliseconds.
 *
 * The season-final dispatch in {@link runFidelityValidators} stays in place as
 * a regression net: the validators are deterministic over inputs that should
 * not change mid-run, so after a clean plan-time pass the net only fires if
 * something mutated the plan during generation (which is exactly the case
 * worth catching late).
 *
 * Mirrors §4.6 semantics: on a non-treatment run the final contract downgrades
 * fidelity findings to advisory, so plan-time reports no blocking errors there
 * either. Each validator is guarded — a throw degrades to no findings, never
 * aborts planning.
 */
export function runPlanTimeFidelityChecks(input: {
  seasonPlan?: SeasonPlan;
  sourceAnalysis?: SourceMaterialAnalysis;
}): PlanTimeFidelityResult {
  const { seasonPlan, sourceAnalysis } = input;
  const treatmentSourced = isTreatmentSourced(sourceAnalysis, seasonPlan);
  if (!treatmentSourced || !seasonPlan || !sourceAnalysis) return EMPTY_PLAN_TIME;

  const findings: FidelityFinding[] = [];
  const guard = (fn: () => FidelityFinding[]): void => {
    try {
      findings.push(...fn());
    } catch {
      // A validator failure must not abort planning; degrade to no findings.
    }
  };

  if (isGateEnabledAt(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance, 'plan')) {
    guard(() => {
      const result = new AuthoredEpisodeConformanceValidator().validate({
        treatment: treatmentFromAnalysis(sourceAnalysis),
        seasonPlan,
      });
      return toFindings('AuthoredEpisodeConformanceValidator', result.issues);
    });
  }

  const beatEpisodeAnchors = sourceAnalysis.treatmentSeasonGuidance?.beatEpisodeAnchors as
    | Partial<Record<SevenPointBeat, number>>
    | undefined;
  if (isGateEnabledAt(TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance, 'plan') && beatEpisodeAnchors) {
    guard(() => {
      const result = new SevenPointAnchorConformanceValidator().validate(
        seasonPlanToAnchorConformanceInput(seasonPlan, beatEpisodeAnchors),
      );
      return toFindings('SevenPointAnchorConformanceValidator', result.issues);
    });
  }

  if (isGateEnabled('GATE_TREATMENT_FIELD_UTILIZATION')) {
    guard(() => {
      const result = new TreatmentFieldUtilizationValidator().validatePlan({
        seasonPlan,
        sourceAnalysis,
      });
      return toFindings('TreatmentFieldUtilizationValidator', result.issues);
    });
  }

  if (isGateEnabled('GATE_SEASON_PROMISE_REALIZATION')) {
    guard(() => {
      const result = new SeasonPromiseRealizationValidator().validatePlan({
        seasonPlan,
        sourceAnalysis,
        treatmentSourced,
      });
      return toFindings('SeasonPromiseRealizationValidator', result.issues);
    });
  }

  if (isGateEnabled('GATE_CHARACTER_TREATMENT_REALIZATION')) {
    guard(() => {
      const result = new CharacterTreatmentRealizationValidator().validatePlan({
        seasonPlan,
        sourceAnalysis,
        treatmentSourced,
      });
      return toFindings('CharacterTreatmentRealizationValidator', result.issues);
    });
  }

  if (isGateEnabled('GATE_FAILURE_MODE_AUDIT_REALIZATION') && !isGateEnabled('GATE_TREATMENT_FIELD_UTILIZATION')) {
    guard(() => {
      const result = new TreatmentFieldUtilizationValidator().validatePlan({
        seasonPlan,
        sourceAnalysis,
      });
      return toFindings('TreatmentFieldUtilizationValidator', result.issues.filter((issue) =>
        issue.location?.startsWith('failureModeAudit:') || issue.message.includes('Failure mode audit field')
      ));
    });
  }

  return {
    findings,
    blockingErrors: findings.filter((f) => f.severity === 'error'),
    treatmentSourced,
  };
}
