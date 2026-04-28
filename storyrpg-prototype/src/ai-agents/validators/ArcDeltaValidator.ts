/**
 * ArcDeltaValidator
 *
 * Given a CharacterArcTargets plan and a simulated/observed start+end
 * identity profile for the episode, verifies that identity and relationship
 * deltas move in the planned direction and within tolerance.
 *
 * Works on either:
 *   - Simulated deltas: accumulated consequences from all authored choices
 *     in the episode (best-effort path-independent snapshot), or
 *   - Observed deltas: a single actual PlayerState start/end pair.
 */

import { BaseValidator, ValidationResult, ValidationIssue } from './BaseValidator';
import { IdentityProfile } from '../../types';
import { CharacterArcTargets } from '../agents/CharacterArcTracker';

export interface ArcDeltaInput {
  targets: CharacterArcTargets;
  startIdentity?: Partial<IdentityProfile>;
  endIdentity?: Partial<IdentityProfile>;
  /** Observed relationship deltas keyed by npcId. */
  relationshipDeltas?: Record<
    string,
    { trust?: number; respect?: number; bond?: number }
  >;
}

export interface ArcDeltaMetrics {
  identityTargetsHit: number;
  identityTargetsTotal: number;
  relationshipTargetsHit: number;
  relationshipTargetsTotal: number;
}

export interface ArcDeltaResult extends ValidationResult {
  metrics: ArcDeltaMetrics;
}

// Tolerance: a target delta is "hit" if observed delta is within ± tol of it,
// OR at least 50% of the planned magnitude in the same direction.
const TOLERANCE_ABS = 5;
const MIN_FRACTION = 0.5;

export class ArcDeltaValidator extends BaseValidator {
  constructor() {
    super('ArcDeltaValidator');
  }

  validate(input: ArcDeltaInput): ArcDeltaResult {
    const issues: ValidationIssue[] = [];
    const targets = input.targets;

    const metrics: ArcDeltaMetrics = {
      identityTargetsHit: 0,
      identityTargetsTotal: targets.identityTargets.length,
      relationshipTargetsHit: 0,
      relationshipTargetsTotal: targets.relationshipTargets.length,
    };

    const start = input.startIdentity || {};
    const end = input.endIdentity || {};
    for (const t of targets.identityTargets) {
      const startVal = Number(start[t.axis] ?? 0);
      const endVal = Number(end[t.axis] ?? 0);
      const observed = endVal - startVal;
      const planned = t.delta;
      if (this.deltaHit(planned, observed)) {
        metrics.identityTargetsHit++;
      } else {
        const dirPlanned = Math.sign(planned);
        const dirObserved = Math.sign(observed);
        const wrongDirection = dirPlanned !== 0 && dirObserved !== 0 && dirPlanned !== dirObserved;
        issues.push({
          severity: wrongDirection ? 'error' : 'warning',
          message: `Identity axis "${t.axis}" ${wrongDirection ? 'moved opposite' : 'fell short of'} planned delta (planned ${planned}, observed ${observed})`,
          suggestion: `Add or rebalance choices whose consequences move \`${t.axis}\` by ~${planned}.`,
        });
      }
    }

    const relDeltas = input.relationshipDeltas || {};
    for (const r of targets.relationshipTargets) {
      const observed = relDeltas[r.npcId] || {};
      let hits = 0;
      let checks = 0;
      const checkAxis = (planned: number | undefined, actual: number | undefined, label: string) => {
        if (planned === undefined) return;
        checks++;
        if (this.deltaHit(planned, actual ?? 0)) {
          hits++;
        } else {
          issues.push({
            severity: 'warning',
            message: `Relationship ${label} for ${r.npcId} missed planned delta (planned ${planned}, observed ${actual ?? 0})`,
            suggestion: `Add choices whose consequences adjust ${r.npcId}.${label} by ~${planned}.`,
          });
        }
      };
      checkAxis(r.trustDelta, observed.trust, 'trust');
      checkAxis(r.respectDelta, observed.respect, 'respect');
      checkAxis(r.bondDelta, observed.bond, 'bond');
      // Consider the relationship target hit if every specified axis was hit.
      if (checks > 0 && hits === checks) {
        metrics.relationshipTargetsHit++;
      }
    }

    const total = metrics.identityTargetsTotal + metrics.relationshipTargetsTotal;
    const hit = metrics.identityTargetsHit + metrics.relationshipTargetsHit;
    const score = total === 0 ? 100 : Math.round((hit / total) * 100);
    const errors = issues.filter(i => i.severity === 'error').length;

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map(i => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics,
    };
  }

  private deltaHit(planned: number, observed: number): boolean {
    if (planned === 0) return Math.abs(observed) <= TOLERANCE_ABS;
    if (Math.sign(planned) !== Math.sign(observed)) return false;
    if (Math.abs(observed - planned) <= TOLERANCE_ABS) return true;
    if (Math.abs(observed) >= Math.abs(planned) * MIN_FRACTION) return true;
    return false;
  }
}
