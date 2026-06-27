import type {
  ValidatorExecutionIssue,
  ValidatorExecutionLifecycle,
  ValidatorExecutionRecord,
  ValidatorExecutionRepairRoute,
  ValidatorExecutionRole,
  ValidatorExecutionSeverity,
} from '../../types/validation';
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
  location?: unknown;
  source?: string;
  suggestion?: string;
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
  return issues.map((issue) => ({
    severity: normalizeSeverity(issue.severity ?? issue.level),
    message: issue.message ?? 'Validator emitted an issue without a message.',
    code: issue.code,
    location: issue.location,
    source: issue.source,
    suggestion: issue.suggestion,
  }));
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

  return {
    validatorId: input.validatorId,
    lifecycle: input.lifecycle ?? registryEntry?.lifecycle ?? 'final-contract',
    role: input.role ?? registryEntry?.role ?? 'primary',
    gateFlag,
    gateEnabled: input.gateEnabled ?? (gateFlag ? isGateEnabled(gateFlag) : true),
    placement: input.placement ?? registryEntry?.gatePlacement ?? gate?.placement,
    passed: input.passed ?? !failed,
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
