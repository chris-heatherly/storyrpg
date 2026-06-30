import type { SceneVisualSequencePlan } from '../../types';

export interface SequencePlanSpecificityIssue {
  field: keyof SceneVisualSequencePlan;
  severity: 'warning' | 'blocking';
  message: string;
}

export interface SequencePlanSpecificityResult {
  passed: boolean;
  issues: SequencePlanSpecificityIssue[];
}

const CONCRETE_RE = /\b(door|window|table|desk|bed|screen|phone|letter|key|card|ring|map|bar|booth|stairs|street|car|threshold|rope|laptop|knife|cup|bag|mirror|hall|corridor|kitchen|office|club|apartment|market|station|bridge|gate|lamp|light|hand|hands|crowd|floor|wall|chair|counter|room|exit|route)\b/i;
const GENERIC_RE = /\b(scene geography|geography$|track power|clear spatial dynamic|visible emotional shift|visible change|emotional position|spatial relationship|leverage, attention, distance, or object control|unresolved pressure)\b/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isGeneric(value: unknown): boolean {
  const raw = text(value);
  const concreteProbe = raw
    .replace(/\bkey object\b/ig, '')
    .replace(/\bclear exit\b/ig, '');
  if (raw.length < 16) return true;
  if (GENERIC_RE.test(raw) && !CONCRETE_RE.test(concreteProbe)) return true;
  return false;
}

export function auditSequencePlanSpecificity(
  plan: SceneVisualSequencePlan | undefined,
  options: { requirePhysicalCarrier?: boolean; legacyTolerant?: boolean } = {},
): SequencePlanSpecificityResult {
  const issues: SequencePlanSpecificityIssue[] = [];
  const severity: SequencePlanSpecificityIssue['severity'] = options.legacyTolerant ? 'warning' : 'blocking';
  if (!plan) {
    return {
      passed: Boolean(options.legacyTolerant),
      issues: [{ field: 'objective', severity, message: 'Scene is missing sceneVisualSequencePlan.' }],
    };
  }

  for (const field of ['geography', 'activity', 'visualThread', 'powerBlocking', 'turningPoint', 'endState'] as const) {
    if (isGeneric(plan[field])) {
      issues.push({
        field,
        severity,
        message: `${field} is too generic to guide storyboard continuity.`,
      });
    }
  }

  if (!Array.isArray(plan.anchorZones) || plan.anchorZones.length < 2) {
    issues.push({ field: 'anchorZones', severity, message: 'Scene visual plan needs at least two concrete anchor zones.' });
  }
  if (isGeneric(plan.boundaryOrThreshold)) {
    issues.push({ field: 'boundaryOrThreshold', severity, message: 'Scene visual plan needs a concrete boundary or threshold.' });
  }
  if (options.requirePhysicalCarrier && isGeneric(plan.physicalCarrier)) {
    issues.push({ field: 'physicalCarrier', severity, message: 'Quiet/dialogue scene needs a physical carrier for visible change.' });
  }

  return {
    passed: !issues.some((issue) => issue.severity === 'blocking'),
    issues,
  };
}
