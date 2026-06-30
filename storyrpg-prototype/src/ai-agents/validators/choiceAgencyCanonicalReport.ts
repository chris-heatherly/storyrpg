import type {
  ChoiceAgencyCanonicalReport,
  ChoiceAgencyContract,
  ChoiceAgencyFinding,
  ChoiceAgencyRepairRoute,
  ValidationIssue,
} from '../../types/validation';

const CHOICE_AGENCY_CONTRACTS: ChoiceAgencyContract[] = [
  'choice_classification_invalid',
  'choice_impact_domain_missing',
  'choice_stakes_missing',
  'choice_stakes_weak',
  'choice_reactive_surface_missing',
  'playable_failure_missing',
  'branch_residue_missing',
  'branch_residue_not_distinct',
  'branch_residue_contract_mismatch',
  'skill_surface_missing',
  'skill_surface_mechanics_leak',
  'choice_reference_invalid',
];

const CONTRACT_DEFAULT_SEVERITY: Record<ChoiceAgencyContract, ChoiceAgencyFinding['severity']> = {
  choice_classification_invalid: 'error',
  choice_impact_domain_missing: 'warning',
  choice_stakes_missing: 'error',
  choice_stakes_weak: 'warning',
  choice_reactive_surface_missing: 'error',
  playable_failure_missing: 'warning',
  branch_residue_missing: 'warning',
  branch_residue_not_distinct: 'warning',
  branch_residue_contract_mismatch: 'warning',
  skill_surface_missing: 'warning',
  skill_surface_mechanics_leak: 'error',
  choice_reference_invalid: 'error',
};

const CONTRACT_REPAIR_ROUTE: Record<ChoiceAgencyContract, ChoiceAgencyRepairRoute> = {
  choice_classification_invalid: 'choice-repair',
  choice_impact_domain_missing: 'choice-repair',
  choice_stakes_missing: 'choice-stakes-repair',
  choice_stakes_weak: 'choice-stakes-repair',
  choice_reactive_surface_missing: 'choice-repair',
  playable_failure_missing: 'choice-repair',
  branch_residue_missing: 'branch-residue-repair',
  branch_residue_not_distinct: 'branch-residue-repair',
  branch_residue_contract_mismatch: 'branch-residue-repair',
  skill_surface_missing: 'skill-surface-repair',
  skill_surface_mechanics_leak: 'skill-surface-repair',
  choice_reference_invalid: 'reference-integrity-repair',
};

const SOURCE_VALIDATOR_BY_CATEGORY: Partial<Record<ValidationIssue['category'], string>> = {
  choice_impact: 'ChoiceImpactValidator',
  five_factor: 'FiveFactorValidator',
  stakes_triangle: 'StakesTriangleValidator',
  mechanical_storytelling: 'MechanicalStorytellingValidator',
  skill_surface: 'SkillSurfaceValidator',
  branch_mechanical_divergence: 'BranchMechanicalDivergenceValidator',
};

const NEVER_SUPPRESS: ReadonlySet<ChoiceAgencyContract> = new Set([
  'choice_classification_invalid',
  'choice_stakes_weak',
  'branch_residue_not_distinct',
  'branch_residue_contract_mismatch',
  'skill_surface_mechanics_leak',
  'choice_reference_invalid',
]);

export function buildChoiceAgencyCanonicalReport(issues: ValidationIssue[]): ChoiceAgencyCanonicalReport {
  const rawFindings = issues
    .map(issueToChoiceAgencyFinding)
    .filter((finding): finding is ChoiceAgencyFinding => Boolean(finding));

  const findings: ChoiceAgencyFinding[] = [];
  const suppressedDuplicates: ChoiceAgencyCanonicalReport['suppressedDuplicates'] = [];
  const firstByKey = new Map<string, ChoiceAgencyFinding>();

  for (const finding of rawFindings) {
    if (NEVER_SUPPRESS.has(finding.contract)) {
      findings.push(finding);
      continue;
    }

    const existing = firstByKey.get(finding.dedupeKey);
    if (!existing) {
      firstByKey.set(finding.dedupeKey, finding);
      findings.push(finding);
      continue;
    }

    suppressedDuplicates.push({
      suppressed: finding,
      canonicalId: existing.id,
      reason: 'same contract, target, normalized severity, and repair route',
    });
  }

  const byContract = emptyContractCounts();
  for (const finding of findings) {
    byContract[finding.contract] += 1;
  }

  return {
    findings,
    suppressedDuplicates,
    metrics: {
      rawFindingCount: rawFindings.length,
      canonicalFindingCount: findings.length,
      suppressedDuplicateCount: suppressedDuplicates.length,
      byContract,
    },
  };
}

function issueToChoiceAgencyFinding(issue: ValidationIssue): ChoiceAgencyFinding | undefined {
  const contract = classifyContract(issue);
  if (!contract) return undefined;

  const sourceValidator = SOURCE_VALIDATOR_BY_CATEGORY[issue.category] ?? issue.category;
  const severity = normalizedSeverity(contract, issue);
  const repairRoute = CONTRACT_REPAIR_ROUTE[contract];
  const sceneId = issue.location.sceneId;
  const beatId = issue.location.beatId;
  const choiceId = issue.location.choiceId;
  const targetKey = targetFor(contract, issue);
  const dedupeKey = [
    contract,
    targetKey,
    severity,
    repairRoute,
    runtimeSafetyClass(contract),
    obligationKey(issue),
  ].join('|');

  return {
    id: `choice-agency:${dedupeKey}`,
    contract,
    sourceValidator,
    severity,
    sceneId,
    beatId,
    choiceId,
    repairRoute,
    message: issue.message,
    suggestion: issue.suggestion,
    rawCategory: issue.category,
    dedupeKey,
  };
}

function classifyContract(issue: ValidationIssue): ChoiceAgencyContract | undefined {
  const message = issue.message;

  switch (issue.category) {
    case 'choice_impact':
      if (/flavor\/expression choice .* branches/i.test(message)) return 'choice_classification_invalid';
      if (/has no impactFactors/i.test(message)) return 'choice_impact_domain_missing';
      if (/needs complete stakes metadata/i.test(message)) return 'choice_stakes_missing';
      if (/tiered as .* but has no durable consequence or route impact/i.test(message)) return 'choice_reactive_surface_missing';
      return undefined;

    case 'five_factor':
      if (/no meaningful impact|zero factors|affects zero factors/i.test(message)) return 'choice_impact_domain_missing';
      return undefined;

    case 'stakes_triangle':
      if (/missing stakes/i.test(message)) return 'choice_stakes_missing';
      if (/\b(?:WANT|COST|IDENTITY) score \(\d+\) below threshold/i.test(message)) return 'choice_stakes_weak';
      return undefined;

    case 'mechanical_storytelling':
      if (/has no visible reactive surface/i.test(message)) return 'choice_reactive_surface_missing';
      if (/has no playable failure signal/i.test(message)) return 'playable_failure_missing';
      if (/references unknown NPC|targets unknown NPC|is not listed in scene/i.test(message)) return 'choice_reference_invalid';
      return undefined;

    case 'skill_surface':
      if (/leaks mechanics/i.test(message)) return 'skill_surface_mechanics_leak';
      if (/has no skill surface|has fewer than two skill surfaces/i.test(message)) return 'skill_surface_missing';
      return undefined;

    case 'branch_mechanical_divergence':
      if (/reconverges with no obvious mechanical residue/i.test(message)) return 'branch_residue_missing';
      if (/multiple branch choices with identical mechanical residue/i.test(message)) return 'branch_residue_not_distinct';
      if (/does not match the authored branch pressure/i.test(message)) return 'branch_residue_contract_mismatch';
      return undefined;

    default:
      return undefined;
  }
}

function normalizedSeverity(contract: ChoiceAgencyContract, issue: ValidationIssue): ChoiceAgencyFinding['severity'] {
  if (contract === 'choice_stakes_weak') return issue.level;
  if (contract === 'choice_reference_invalid' && /is not listed in scene/i.test(issue.message)) return 'warning';
  return CONTRACT_DEFAULT_SEVERITY[contract];
}

function targetFor(contract: ChoiceAgencyContract, issue: ValidationIssue): string {
  const { sceneId, beatId, choiceId } = issue.location;
  if (contract === 'skill_surface_missing' || contract === 'branch_residue_not_distinct') {
    return `scene:${sceneId ?? beatId ?? choiceId ?? 'unknown'}`;
  }
  return [
    sceneId ? `scene:${sceneId}` : undefined,
    beatId ? `beat:${beatId}` : undefined,
    choiceId ? `choice:${choiceId}` : undefined,
  ].filter(Boolean).join('/') || normalizeMessageTarget(issue.message);
}

function runtimeSafetyClass(contract: ChoiceAgencyContract): 'hard-runtime' | 'story-agency' {
  return contract === 'choice_reference_invalid' || contract === 'skill_surface_mechanics_leak'
    ? 'hard-runtime'
    : 'story-agency';
}

function obligationKey(issue: ValidationIssue): string {
  return issue.location.choiceId || issue.location.beatId || issue.location.sceneId || normalizeMessageTarget(issue.message);
}

function normalizeMessageTarget(message: string): string {
  return message
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'unknown';
}

function emptyContractCounts(): Record<ChoiceAgencyContract, number> {
  return Object.fromEntries(CHOICE_AGENCY_CONTRACTS.map((contract) => [contract, 0])) as Record<ChoiceAgencyContract, number>;
}
