import type {
  ValidatorExecutionIssue,
  ValidatorExecutionLifecycle,
  ValidatorExecutionRecord,
  ValidatorExecutionRepairRoute,
  ValidatorExecutionRole,
  ValidatorExecutionSeverity,
} from '../../types/validation';
import type {
  ValidationExecutionMode,
  ValidationOwnershipMetadata,
} from '../../types/validationOwnership';
import { isGateEnabled } from '../remediation/gateDefaults';
import { GATE_REGISTRY, type GatePlacement } from '../remediation/gateRegistry';
import {
  validatorById,
  validatorForGate,
  type ValidatorRemediation,
} from './validatorRegistry';

type IssueLike = {
  severity?: string;
  level?: string;
  message?: string;
  code?: string;
  type?: string;
  issueCode?: string;
  location?: unknown;
  source?: string;
  suggestion?: string;
  metadata?: ValidationOwnershipMetadata & { realizationFingerprint?: string };
  taskId?: string;
  contractId?: string;
  eventId?: string;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  outcomeTier?: string;
  artifactPath?: string;
  repairHandler?: string;
  ownerStage?: ValidationOwnershipMetadata['ownerStage'];
  retryClass?: ValidationOwnershipMetadata['retryClass'];
  missingEvidenceAtoms?: string[];
  requiredEvidenceAtoms?: string[];
  matchedForbiddenAtoms?: string[];
  realizationFingerprint?: string;
};

export interface CreateValidatorExecutionRecordInput {
  validatorId: string;
  issues?: IssueLike[];
  lifecycle?: ValidatorExecutionLifecycle;
  role?: ValidatorExecutionRole;
  gateFlag?: string;
  gateEnabled?: boolean;
  placement?: GatePlacement;
  passed?: boolean;
  repair?: ValidatorExecutionRecord['repair'];
  policyId?: string;
  mode?: ValidationExecutionMode;
  artifactRefs?: string[];
  durationMs?: number;
  effectiveSeverityReason?: string;
}

const gateById = new Map(GATE_REGISTRY.map((gate) => [gate.id, gate]));

function normalizeSeverity(raw: string | undefined): ValidatorExecutionSeverity {
  if (raw === 'error' || raw === 'warning' || raw === 'info' || raw === 'suggestion') {
    return raw;
  }
  return 'info';
}

function toRepairRoute(route: ValidatorRemediation | undefined): ValidatorExecutionRepairRoute | undefined {
  return route;
}

export function validatorExecutionIssuesFromIssues(issues: IssueLike[] = []): ValidatorExecutionIssue[] {
  return issues.map((issue) => {
    const directOwnership: ValidationOwnershipMetadata = {
      issueCode: issue.issueCode ?? issue.code ?? issue.type,
      taskId: issue.taskId,
      contractId: issue.contractId,
      eventId: issue.eventId,
      episodeNumber: issue.episodeNumber,
      sceneId: issue.sceneId,
      beatId: issue.beatId,
      outcomeTier: issue.outcomeTier,
      artifactPath: issue.artifactPath,
      repairHandler: issue.repairHandler,
      ownerStage: issue.ownerStage,
      retryClass: issue.retryClass,
      missingEvidenceAtoms: issue.missingEvidenceAtoms,
      requiredEvidenceAtoms: issue.requiredEvidenceAtoms,
      matchedForbiddenAtoms: issue.matchedForbiddenAtoms,
      findingFingerprint: issue.realizationFingerprint,
    };
    const ownership = {
      ...directOwnership,
      ...issue.metadata,
      findingFingerprint: issue.metadata?.findingFingerprint
        ?? issue.metadata?.realizationFingerprint
        ?? directOwnership.findingFingerprint,
    };
    const hasOwnership = Object.values(ownership).some((value) => value !== undefined);
    return {
      severity: normalizeSeverity(issue.severity ?? issue.level),
      message: issue.message ?? 'Validator emitted an issue without a message.',
      code: issue.issueCode ?? issue.code ?? issue.type ?? ownership.issueCode,
      location: issue.location,
      source: issue.source,
      suggestion: issue.suggestion,
      ...(hasOwnership ? { ownership } : {}),
    };
  });
}

export function createValidatorExecutionRecord(
  input: CreateValidatorExecutionRecordInput,
): ValidatorExecutionRecord {
  const registryEntry = input.gateFlag
    ? validatorForGate(input.gateFlag) ?? validatorById(input.validatorId)
    : validatorById(input.validatorId);
  const gateFlag = input.gateFlag ?? registryEntry?.rolloutFlag;
  const gate = gateFlag ? gateById.get(gateFlag) : undefined;
  const issues = validatorExecutionIssuesFromIssues(input.issues);
  const failed = issues.some((issue) => issue.severity === 'error');
  const role = input.role ?? registryEntry?.role ?? 'primary';

  return {
    policyId: input.policyId ?? registryEntry?.policyId,
    validatorId: input.validatorId,
    lifecycle: input.lifecycle ?? registryEntry?.lifecycle ?? 'final-contract',
    role,
    gateFlag,
    gateEnabled: input.gateEnabled ?? (gateFlag ? isGateEnabled(gateFlag) : true),
    placement: input.placement ?? registryEntry?.gatePlacement ?? gate?.placement,
    passed: input.passed ?? !failed,
    mode: input.mode ?? (role === 'shadow' ? 'shadow' : role === 'regression-net' ? 'audit' : 'enforce'),
    artifactRefs: input.artifactRefs,
    durationMs: input.durationMs,
    effectiveSeverityReason: input.effectiveSeverityReason,
    issues,
    repair: input.repair ?? (registryEntry?.remediation
      ? { attempted: false, route: toRepairRoute(registryEntry.remediation) }
      : undefined),
  };
}

export function createValidatorExecutionRecordsFromGroupedIssues(
  findings: Array<IssueLike & { validator?: string }>,
  options: Omit<CreateValidatorExecutionRecordInput, 'validatorId' | 'issues'> & {
    validatorGateFlags?: Record<string, string | undefined>;
  } = {},
): ValidatorExecutionRecord[] {
  const byValidator = new Map<string, IssueLike[]>();
  for (const finding of findings) {
    if (!finding.validator) continue;
    const bucket = byValidator.get(finding.validator) ?? [];
    bucket.push(finding);
    byValidator.set(finding.validator, bucket);
  }

  return [...byValidator.entries()].map(([validatorId, issues]) =>
    createValidatorExecutionRecord({
      ...options,
      validatorId,
      gateFlag: options.validatorGateFlags?.[validatorId] ?? options.gateFlag,
      issues,
    })
  );
}
