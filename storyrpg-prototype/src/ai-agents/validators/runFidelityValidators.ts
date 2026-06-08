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
}

const EMPTY: RunFidelityValidatorsResult = { fidelityFindings: [], treatmentSourced: false };

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

/** True when the run was sourced from an authored treatment (drives §4.6 blocking). */
function isTreatmentSourced(analysis: SourceMaterialAnalysis | undefined): boolean {
  if (!analysis) return false;
  if (analysis.sourceFormat === 'story_treatment') return true;
  if (analysis.treatmentMetadata?.detected) return true;
  // Defensive: any parsed authored episode guidance also implies a treatment source.
  return Object.values(analysis.treatmentSeasonGuidance ?? {}).length > 0;
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
  const { story, seasonPlan, sourceAnalysis } = input;
  const findings: FidelityFinding[] = [];

  const beatEpisodeAnchors = sourceAnalysis?.treatmentSeasonGuidance?.beatEpisodeAnchors as
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
  if (isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance) && sourceAnalysis && seasonPlan) {
    guard(() => {
      const result = new AuthoredEpisodeConformanceValidator().validate({
        treatment: treatmentFromAnalysis(sourceAnalysis),
        seasonPlan,
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
      const result = new SignatureDevicePresenceValidator().validate({ plan: scenePlan, story });
      return toFindings('SignatureDevicePresenceValidator', result.issues);
    });
  }

  // 4.5 — each authored beat→episode anchor is honored in the final season.
  if (isEnabled(TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance) && seasonPlan && beatEpisodeAnchors) {
    guard(() => {
      const result = new SevenPointAnchorConformanceValidator().validate(
        seasonPlanToAnchorConformanceInput(seasonPlan, beatEpisodeAnchors),
      );
      return toFindings('SevenPointAnchorConformanceValidator', result.issues);
    });
  }

  return findings;
}

export function runFidelityValidators(input: RunFidelityValidatorsInput): RunFidelityValidatorsResult {
  const treatmentSourced = isTreatmentSourced(input.sourceAnalysis);
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
