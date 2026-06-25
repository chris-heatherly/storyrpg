import type { Choice, Relationship, RelationshipValueEvidence, RelationshipValueState } from '../../types';
import {
  classifyRelationshipValueState,
  enforceRelationshipTransition,
  getSurfacesForRung,
} from '../../engine/relationshipValueLadder';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface RelationshipValueTransitionCheck {
  previous?: RelationshipValueState;
  next: RelationshipValueState;
}

export interface RelationshipValueLadderInput {
  relationships: Record<string, Relationship>;
  states?: RelationshipValueState[];
  choices?: Array<Choice & { sceneId?: string; beatId?: string }>;
  transitions?: RelationshipValueTransitionCheck[];
}

export interface RelationshipValueLadderMetrics {
  statesChecked: number;
  choicesChecked: number;
  transitionsChecked: number;
  rungMismatches: number;
  invalidSurfaces: number;
  blockedTransitions: number;
}

export interface RelationshipValueLadderResult extends ValidationResult {
  metrics: RelationshipValueLadderMetrics;
}

export class RelationshipValueLadderValidator extends BaseValidator {
  constructor() {
    super('RelationshipValueLadderValidator');
  }

  validate(input: RelationshipValueLadderInput): RelationshipValueLadderResult {
    const issues: ValidationIssue[] = [];
    const metrics: RelationshipValueLadderMetrics = {
      statesChecked: 0,
      choicesChecked: input.choices?.length ?? 0,
      transitionsChecked: input.transitions?.length ?? 0,
      rungMismatches: 0,
      invalidSurfaces: 0,
      blockedTransitions: 0,
    };

    for (const state of input.states ?? []) {
      metrics.statesChecked++;
      const relationship = input.relationships[state.npcId];
      if (!relationship) {
        issues.push(this.error(
          `Relationship value state references unknown NPC "${state.npcId}".`,
          stateLocation(state),
          'Use an npcId from story/player relationships or remove this value state.',
        ));
        continue;
      }

      const classified = classifyRelationshipValueState({
        npcId: state.npcId,
        axis: state.axis,
        relationship,
        evidenceTags: state.evidenceTags,
      });
      if (classified.rung !== state.rung) {
        metrics.rungMismatches++;
        issues.push(this.warning(
          `Relationship value state for "${state.npcId}" says "${state.rung}" but deterministic classification is "${classified.rung}".`,
          stateLocation(state),
          'Adjust relationship dimensions/evidence tags, or use the deterministic rung.',
        ));
      }

      const allowed = new Set(getSurfacesForRung(state.rung));
      for (const surface of state.allowedSurfaces ?? []) {
        if (!allowed.has(surface)) {
          metrics.invalidSurfaces++;
          issues.push(this.warning(
            `Surface "${surface}" is not allowed for rung "${state.rung}".`,
            stateLocation(state),
            `Use one of: ${Array.from(allowed).join(', ')}.`,
          ));
        }
      }
    }

    for (const choice of input.choices ?? []) {
      for (const evidence of choice.relationshipValueEvidence ?? []) {
        this.validateEvidenceSurface(evidence, choice, issues, metrics);
      }
    }

    for (const transition of input.transitions ?? []) {
      const result = enforceRelationshipTransition(transition.previous, transition.next);
      if (result.blockedTransition) {
        metrics.blockedTransitions++;
        issues.push(this.warning(
          `Blocked relationship rung transition ${result.blockedTransition.from} -> ${result.blockedTransition.to}: ${result.blockedTransition.reason}`,
          stateLocation(transition.next),
          'Add the required evidence event or route the relationship through an intermediate rung.',
        ));
      }
    }

    const errors = issues.filter(issue => issue.severity === 'error').length;
    const warnings = issues.filter(issue => issue.severity === 'warning').length;

    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 25 - warnings * 8),
      issues,
      suggestions: issues.map(issue => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics,
    };
  }

  private validateEvidenceSurface(
    evidence: RelationshipValueEvidence,
    choice: Choice & { sceneId?: string; beatId?: string },
    issues: ValidationIssue[],
    metrics: RelationshipValueLadderMetrics,
  ): void {
    if (!evidence.intendedSurface) return;

    const location = [choice.sceneId, choice.beatId, choice.id, evidence.npcId].filter(Boolean).join(':');
    const allSurfaces = new Set([
      ...getSurfacesForRung('positive'),
      ...getSurfacesForRung('contrary'),
      ...getSurfacesForRung('contradiction'),
      ...getSurfacesForRung('negationOfNegation'),
    ]);
    if (!allSurfaces.has(evidence.intendedSurface)) {
      metrics.invalidSurfaces++;
      issues.push(this.error(
        `Choice "${choice.id}" uses unknown relationship surface "${evidence.intendedSurface}".`,
        location,
        'Use a RelationshipSurface enum value.',
      ));
    }
  }
}

function stateLocation(state: RelationshipValueState): string {
  return `${state.npcId}:${state.axis}`;
}
