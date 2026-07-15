import type {
  TreatmentObligationCanonicalReport,
  TreatmentObligationContract,
  TreatmentObligationFinding,
  TreatmentRepairRoute,
} from '../../types/validation';
import type { FinalStoryContractIssue } from './FinalStoryContractValidator';
import type { FidelityFinding } from './runFidelityValidators';
import { classifyTreatmentObligation } from './treatmentObligationClassifier';

type TreatmentFindingInput = FidelityFinding & {
  phase?: TreatmentObligationFinding['phase'];
};

export interface BuildTreatmentObligationCanonicalReportInput {
  fidelityFindings?: FidelityFinding[];
  planTimeFidelityFindings?: FidelityFinding[];
  finalContractIssues?: FinalStoryContractIssue[];
  treatmentSourced?: boolean;
  generatedEpisodeNumbers?: number[];
  requestedEpisodeNumbers?: number[];
}

const TREATMENT_CONTRACTS: TreatmentObligationContract[] = [
  'treatment_plan_conformance',
  'treatment_obligation_realization',
  'treatment_information_schedule',
  'treatment_signature_realization',
  'treatment_character_realization',
  'treatment_season_promise_realization',
  'treatment_encounter_anchor_realization',
  'treatment_failure_mode_realization',
  'treatment_scope_notice',
];

const TREATMENT_REPAIR_ROUTES: TreatmentRepairRoute[] = [
  'plan-repair',
  'scene-regen',
  'encounter-regen',
  'ledger-repair',
  'judge-and-regen',
  'final-contract-only',
  'none',
];

const NON_DEDUPE_STATUS_RE = /\b(?:inverted|negated|before|early|late|wrong order|partial slice|partial-season|missing planned episode)/i;

export function buildTreatmentObligationCanonicalReport(
  input: BuildTreatmentObligationCanonicalReportInput,
): TreatmentObligationCanonicalReport {
  const rawFindings = [
    ...(input.planTimeFidelityFindings ?? []).map((finding) => ({ ...finding, phase: 'plan' as const })),
    ...(input.fidelityFindings ?? []).map((finding) => ({ ...finding, phase: 'final' as const })),
    ...finalIssuesToFindings(input.finalContractIssues ?? []),
  ]
    .map((finding) => treatmentFindingToCanonicalFinding(finding, input))
    .filter((finding): finding is TreatmentObligationFinding => Boolean(finding));

  const findings: TreatmentObligationFinding[] = [];
  const suppressedDuplicates: TreatmentObligationCanonicalReport['suppressedDuplicates'] = [];
  const firstByKey = new Map<string, TreatmentObligationFinding>();
  const evidenceByCanonicalId = new Map<string, TreatmentObligationFinding[]>();

  for (const finding of rawFindings) {
    const existing = finding.contract === 'treatment_scope_notice'
      ? undefined
      : firstByKey.get(finding.dedupeKey);

    if (!existing) {
      firstByKey.set(finding.dedupeKey, finding);
      findings.push(finding);
      evidenceByCanonicalId.set(finding.id, [finding]);
      continue;
    }

    suppressedDuplicates.push({
      suppressed: finding,
      canonicalId: existing.id,
      reason: 'same contract, source obligation, target, surface, severity, repair route, phase, and treatment scope',
    });
    evidenceByCanonicalId.get(existing.id)?.push(finding);
  }

  const byContract = emptyContractCounts();
  const byRepairRoute = emptyRepairRouteCounts();
  for (const finding of findings) {
    byContract[finding.contract] += 1;
    byRepairRoute[finding.repairRoute] += 1;
  }

  return {
    findings,
    suppressedDuplicates,
    groupedEvidence: findings.map((finding) => ({
      canonicalId: finding.id,
      evidence: evidenceByCanonicalId.get(finding.id) ?? [finding],
    })),
    metrics: {
      rawFindingCount: rawFindings.length,
      canonicalFindingCount: findings.length,
      suppressedDuplicateCount: suppressedDuplicates.length,
      byContract,
      byRepairRoute,
    },
  };
}

function finalIssuesToFindings(issues: FinalStoryContractIssue[]): TreatmentFindingInput[] {
  return issues.flatMap((issue): TreatmentFindingInput[] => {
    if (issue.type === 'partial_season_scope') {
      return [{
        validator: issue.validator ?? 'FinalStoryContractValidator',
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
        episodeNumber: issue.episodeNumber,
        sceneId: issue.sceneId,
        phase: 'final',
      }];
    }

    if (issue.type !== 'treatment_event_ledger_violation') return [];
    return [{
      validator: issue.validator ?? 'TreatmentEventLedgerValidator',
      severity: issue.severity,
      message: issue.message,
      suggestion: issue.suggestion,
      episodeNumber: issue.episodeNumber,
      sceneId: issue.sceneId,
      phase: 'final',
    }];
  });
}

function treatmentFindingToCanonicalFinding(
  finding: TreatmentFindingInput,
  input: BuildTreatmentObligationCanonicalReportInput,
): TreatmentObligationFinding | undefined {
  const classification = classifyTreatmentFinding(finding);
  if (!classification) return undefined;

  const phase = finding.phase ?? 'final';
  const sourceTextExcerpt = extractSourceTextExcerpt(finding.message);
  const sourceTextFingerprint = sourceTextExcerpt ? normalizeFingerprint(sourceTextExcerpt) : undefined;
  const obligationId = extractObligationId(finding.message);
  const sourceFieldId = sourceTextFingerprint ?? obligationId;
  const statusKey = NON_DEDUPE_STATUS_RE.test(finding.message) ? normalizeStatus(finding.message) : 'presence';
  const targetKey = targetFor(finding, classification.targetSurface);
  const scopeKey = scopeFor(input);
  const sourceKey = obligationId ?? sourceTextFingerprint ?? normalizeFingerprint(finding.message);
  const dedupeKey = [
    classification.contract,
    sourceKey,
    targetKey,
    classification.targetSurface,
    finding.severity,
    classification.repairRoute,
    phase,
    scopeKey,
    statusKey,
  ].join('|');

  return {
    id: `treatment-obligation:${dedupeKey}`,
    contract: classification.contract,
    sourceValidator: finding.validator,
    severity: finding.severity,
    repairRoute: classification.repairRoute,
    episodeNumber: finding.episodeNumber,
    sceneId: finding.sceneId,
    obligationId,
    sourceFieldId,
    sourceTextFingerprint,
    sourceTextExcerpt,
    phase,
    targetSurface: classification.targetSurface,
    message: finding.message,
    suggestion: finding.suggestion,
    rawCategory: finding.validator,
    dedupeKey,
  };
}

function classifyTreatmentFinding(finding: TreatmentFindingInput): Pick<TreatmentObligationFinding, 'contract' | 'repairRoute' | 'targetSurface'> | undefined {
  const message = finding.message;

  switch (finding.validator) {
    case 'AuthoredEpisodeConformanceValidator':
    case 'StoryCircleAnchorConformanceValidator':
      return { contract: 'treatment_plan_conformance', repairRoute: 'plan-repair', targetSurface: 'plan' };

    case 'TreatmentEventLedgerValidator':
      return classifyTreatmentObligation({ validator: finding.validator, message });

    case 'EncounterAnchorContentValidator':
      return { contract: 'treatment_encounter_anchor_realization', repairRoute: 'encounter-regen', targetSurface: 'encounter' };

    case 'InformationLedgerScheduleValidator':
      return { contract: 'treatment_information_schedule', repairRoute: 'ledger-repair', targetSurface: 'information-ledger' };

    case 'SignatureDevicePresenceValidator':
      return classifyTreatmentObligation({ validator: finding.validator, message });

    case 'SeasonPromiseRealizationValidator':
      return /not consumed into concrete plan artifacts/i.test(message)
        ? { contract: 'treatment_plan_conformance', repairRoute: 'plan-repair', targetSurface: 'plan' }
        : { contract: 'treatment_season_promise_realization', repairRoute: 'scene-regen', targetSurface: 'season-promise' };

    case 'CharacterTreatmentRealizationValidator':
      return /not consumed into concrete plan artifacts/i.test(message)
        ? { contract: 'treatment_plan_conformance', repairRoute: 'plan-repair', targetSurface: 'plan' }
        : { contract: 'treatment_character_realization', repairRoute: 'scene-regen', targetSurface: 'character-arc' };

    case 'NarrativeFailureModeValidator':
      if (!/failure-mode audit|Authored failure-mode audit/i.test(message)) return undefined;
      return { contract: 'treatment_failure_mode_realization', repairRoute: 'judge-and-regen', targetSurface: 'failure-mode' };

    case 'TreatmentFieldUtilizationValidator':
      return classifyTreatmentFieldUtilization(message);

    case 'RequiredBeatRealizationValidator':
      if (!/authored|treatment|required beat/i.test(message)) return undefined;
      return classifyTreatmentObligation({ validator: finding.validator, message });

    case 'SceneTurnRealizationValidator':
      if (!/treatment|authored|central turn/i.test(message)) return undefined;
      return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'scene-prose' };

    case 'RelationshipArcLedgerValidator':
    case 'NarrativeMechanicPressureValidator':
    case 'CharacterIntroductionValidator':
      if (!/treatment|authored|contract/i.test(message)) return undefined;
      return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'scene-prose' };

    case 'FinalStoryContractValidator':
      if (/partial slice|partial season|missing planned episode|full-season mode cannot pass/i.test(message)) {
        return { contract: 'treatment_scope_notice', repairRoute: 'final-contract-only', targetSurface: 'scope' };
      }
      return undefined;

    default:
      return undefined;
  }
}

function classifyTreatmentFieldUtilization(message: string): Pick<TreatmentObligationFinding, 'contract' | 'repairRoute' | 'targetSurface'> {
  const planMiss = /not consumed into a concrete plan artifact|not consumed into concrete plan artifacts/i.test(message);
  if (planMiss) {
    return { contract: 'treatment_plan_conformance', repairRoute: 'plan-repair', targetSurface: 'plan' };
  }

  if (/Failure mode audit field/i.test(message)) {
    return { contract: 'treatment_failure_mode_realization', repairRoute: 'judge-and-regen', targetSurface: 'failure-mode' };
  }

  if (/\bsignature\b/i.test(message)) {
    return { contract: 'treatment_signature_realization', repairRoute: 'judge-and-regen', targetSurface: 'signature-device' };
  }

  if (/\bencounter\b/i.test(message)) {
    return { contract: 'treatment_encounter_anchor_realization', repairRoute: 'encounter-regen', targetSurface: 'encounter' };
  }

  if (/\b(?:promise|premise|genre|tone|theme question|core fantasy|inaction pressure)\b/i.test(message)) {
    return { contract: 'treatment_season_promise_realization', repairRoute: 'scene-regen', targetSurface: 'season-promise' };
  }

  if (/World\/location treatment field/i.test(message)) {
    return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'scene-prose' };
  }

  if (/\b(?:protagonist|character|want|need|lie|wound|truth|identity)\b/i.test(message)) {
    return { contract: 'treatment_character_realization', repairRoute: 'scene-regen', targetSurface: 'character-arc' };
  }

  if (/\b(?:info|reveal|payoff|setup touch)\b/i.test(message)) {
    return { contract: 'treatment_information_schedule', repairRoute: 'ledger-repair', targetSurface: 'information-ledger' };
  }

  if (/Legacy-structure beat/i.test(message)) {
    return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'scene-prose' };
  }

  if (/Alternate ending field/i.test(message)) {
    return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'ending' };
  }

  return { contract: 'treatment_obligation_realization', repairRoute: 'scene-regen', targetSurface: 'scene-prose' };
}

function extractSourceTextExcerpt(message: string): string | undefined {
  const quoted = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim()).filter(Boolean);
  return quoted.at(-1);
}

function extractObligationId(message: string): string | undefined {
  const info = message.match(/\bINFO\s+"([^"]+)"/i)?.[1];
  if (info) return `info:${info}`;
  const failureMode = message.match(/\bfailureModeAudit:([A-Za-z0-9_-]+)/)?.[1];
  if (failureMode) return `failure-mode:${failureMode}`;
  const bracketCode = message.match(/^\[([A-Za-z0-9 _-]+)\]/)?.[1];
  if (bracketCode) return `failure-mode:${normalizeFingerprint(bracketCode)}`;
  return undefined;
}

function targetFor(finding: TreatmentFindingInput, surface: TreatmentObligationFinding['targetSurface']): string {
  if (surface === 'scope') return 'scope';
  const parts = [
    typeof finding.episodeNumber === 'number' ? `ep:${finding.episodeNumber}` : undefined,
    finding.sceneId ? `scene:${finding.sceneId}` : undefined,
  ].filter(Boolean);
  return parts.join('/') || 'target:unknown';
}

function scopeFor(input: BuildTreatmentObligationCanonicalReportInput): string {
  const generated = numbersKey(input.generatedEpisodeNumbers);
  const requested = numbersKey(input.requestedEpisodeNumbers);
  if (generated || requested) return `generated:${generated || 'unknown'}|requested:${requested || 'unknown'}`;
  return input.treatmentSourced ? 'treatment-sourced' : 'non-treatment';
}

function numbersKey(values: number[] | undefined): string {
  return [...new Set(values ?? [])]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .join(',');
}

function normalizeStatus(message: string): string {
  if (/\binverted|negated/i.test(message)) return 'inverted';
  if (/\bbefore|early|late|wrong order/i.test(message)) return 'schedule-order';
  if (/partial slice|partial-season|missing planned episode/i.test(message)) return 'scope';
  return 'presence';
}

function normalizeFingerprint(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'unknown';
}

function emptyContractCounts(): Record<TreatmentObligationContract, number> {
  return Object.fromEntries(TREATMENT_CONTRACTS.map((contract) => [contract, 0])) as Record<TreatmentObligationContract, number>;
}

function emptyRepairRouteCounts(): Record<TreatmentRepairRoute, number> {
  return Object.fromEntries(TREATMENT_REPAIR_ROUTES.map((route) => [route, 0])) as Record<TreatmentRepairRoute, number>;
}
