import type {
  ArcEpisodeTurnout,
  ArcEpisodeTurnoutType,
  SeasonArc,
  SeasonPlan,
} from '../../types/seasonPlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface ArcPressureArchitectureOptions {
  episodeStructureMode?: 'standard' | 'sceneEpisodes';
}

export interface ArcPressureArchitectureMetrics {
  arcCount: number;
  arcsWithQuestion: number;
  arcsWithIdentityPressure: number;
  arcsWithMidpointRecontextualization: number;
  arcsWithLateCrisis: number;
  arcsWithCompleteTurnouts: number;
}

export interface ArcPressureArchitectureResult extends ValidationResult {
  metrics: ArcPressureArchitectureMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const VALID_TURNOUT_TYPES = new Set<ArcEpisodeTurnoutType>([
  'setup',
  'escalation',
  'reversal',
  'revelation',
  'cost',
  'choice',
  'recontextualization',
  'crisis',
  'finale',
  'handoff',
]);
const RECONTEXTUALIZATION_LANGUAGE = /\b(reframe|recontextual|misunderstood|really|true|truth|wrong|instead|not just|not merely|actually|changes? the question|question after|understand|assumption|assumed|reveals?)\b/i;
const CRISIS_LANGUAGE = /\b(fail|failure|collapse|lost|loss|cost|irreversible|break|rupture|exposed|compromise|wound|cannot|no longer|betray|damage|apparent)\b/i;
const FLAT_ORDER_LANGUAGE = /\b(then|next|after that|continues|moves on|travels|arrives|later)\b/i;
const TURN_PRESSURE_LANGUAGE = /\b(escalat|reverse|reveal|cost|choice|decision|crisis|finale|handoff|consequence|pressure|because|therefore|but|discovers?|loses?|forces?|changes?|reframes?)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function expectedArcEpisodes(arc: SeasonArc): number[] {
  const start = arc.episodeRange?.start || 1;
  const end = arc.episodeRange?.end || start;
  const episodes: number[] = [];
  for (let episodeNumber = start; episodeNumber <= end; episodeNumber++) {
    episodes.push(episodeNumber);
  }
  return episodes;
}

function textFrom(values: unknown[]): string {
  return values.filter((value): value is string => hasText(value)).join(' ');
}

function turnoutLooksFlat(turnout: ArcEpisodeTurnout): boolean {
  const text = textFrom([
    turnout.description,
    turnout.leavesProtagonistWith,
    turnout.whyThisCannotMoveLater,
  ]);
  if (!hasText(text)) return true;
  return FLAT_ORDER_LANGUAGE.test(text) && !TURN_PRESSURE_LANGUAGE.test(text);
}

export class ArcPressureArchitectureValidator extends BaseValidator {
  constructor() {
    super('ArcPressureArchitectureValidator');
  }

  validate(
    plan: Pick<SeasonPlan, 'arcs' | 'episodes' | 'totalEpisodes'>,
    options: ArcPressureArchitectureOptions = {},
  ): ArcPressureArchitectureResult {
    const issues: ValidationIssue[] = [];
    const arcs = Array.isArray(plan.arcs) ? plan.arcs : [];
    const metrics: ArcPressureArchitectureMetrics = {
      arcCount: arcs.length,
      arcsWithQuestion: 0,
      arcsWithIdentityPressure: 0,
      arcsWithMidpointRecontextualization: 0,
      arcsWithLateCrisis: 0,
      arcsWithCompleteTurnouts: 0,
    };

    if (arcs.length === 0) {
      issues.push(this.error(
        'Season plan has no arcs.',
        'season.arcs',
        'Add at least one arc as a 3-8 episode pressure movement inside the season.',
      ));
      return this.result(issues, metrics);
    }

    for (const arc of arcs) {
      this.validateArc(arc, plan, options, issues, metrics);
    }

    return this.result(issues, metrics);
  }

  private validateArc(
    arc: SeasonArc,
    plan: Pick<SeasonPlan, 'episodes' | 'totalEpisodes'>,
    options: ArcPressureArchitectureOptions,
    issues: ValidationIssue[],
    metrics: ArcPressureArchitectureMetrics,
  ): void {
    const location = `season.arcs.${arc.id || arc.name || 'unknown'}`;
    const start = arc.episodeRange?.start;
    const end = arc.episodeRange?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      issues.push(this.error(
        `Arc "${arc.name}" has an invalid episodeRange.`,
        `${location}.episodeRange`,
        'Arc ranges must point to a contiguous episode chain.',
      ));
      return;
    }

    const length = end - start + 1;
    if (length < 3 || length > 8) {
      issues.push(this.warning(
        `Arc "${arc.name}" spans ${length} episode(s); target 3-8 episodes where practical.`,
        `${location}.episodeRange`,
        options.episodeStructureMode === 'sceneEpisodes'
          ? 'In sceneEpisodes mode, treat this as a sceneEpisode chain. If the chain must be shorter or longer, keep turnouts explicit.'
          : 'If source length forces an exception, keep the arc pressure fields explicit so the exception is intentional.',
      ));
    }

    if (!hasText(arc.arcQuestion)) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing arcQuestion.`,
        `${location}.arcQuestion`,
        'State the arc-level dramatic question, narrower than but related to the season question.',
      ));
    } else {
      metrics.arcsWithQuestion += 1;
    }

    if (!hasText(arc.seasonQuestionRelation)) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing seasonQuestionRelation.`,
        `${location}.seasonQuestionRelation`,
        'Explain how this arc pressures the season goal, stakes, or theme question without competing with the 7-point spine.',
      ));
    }

    if (!hasText(arc.identityPressureFacet)) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing identityPressureFacet.`,
        `${location}.identityPressureFacet`,
        'Name the false belief, wound, fear, vow, loyalty, ambition, self-image, or value conflict this arc pressures.',
      ));
    } else {
      metrics.arcsWithIdentityPressure += 1;
    }

    this.validateMidpoint(arc, location, start, end, issues, metrics);
    this.validateLateCrisis(arc, location, start, end, issues, metrics);
    this.validateFinaleAndHandoff(arc, plan.totalEpisodes, location, issues);
    this.validateTurnouts(arc, location, issues, metrics);
  }

  private validateMidpoint(
    arc: SeasonArc,
    location: string,
    start: number,
    end: number,
    issues: ValidationIssue[],
    metrics: ArcPressureArchitectureMetrics,
  ): void {
    const midpoint = arc.midpointRecontextualization;
    if (!midpoint) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing midpointRecontextualization.`,
        `${location}.midpointRecontextualization`,
        'The middle of the arc must change the question being asked, not just intensify it.',
      ));
      return;
    }

    const midpointText = textFrom([midpoint.questionBefore, midpoint.questionAfter, midpoint.description]);
    if (!hasText(midpoint.questionBefore) || !hasText(midpoint.questionAfter) || !hasText(midpoint.description)) {
      issues.push(this.error(
        `Arc "${arc.name}" has an incomplete midpointRecontextualization.`,
        `${location}.midpointRecontextualization`,
        'Fill questionBefore, questionAfter, and description.',
      ));
      return;
    }
    if (midpoint.episodeNumber < start || midpoint.episodeNumber > end) {
      issues.push(this.error(
        `Arc "${arc.name}" midpointRecontextualization points outside the arc range.`,
        `${location}.midpointRecontextualization.episodeNumber`,
      ));
    }
    if (midpoint.questionBefore.trim() === midpoint.questionAfter.trim() || !RECONTEXTUALIZATION_LANGUAGE.test(midpointText)) {
      issues.push(this.warning(
        `Arc "${arc.name}" midpoint may intensify pressure without clearly changing the question.`,
        `${location}.midpointRecontextualization`,
        'Use questionBefore/questionAfter to show what the protagonist misunderstood, what was revealed, or why the original question was incomplete.',
      ));
    }
    metrics.arcsWithMidpointRecontextualization += 1;
  }

  private validateLateCrisis(
    arc: SeasonArc,
    location: string,
    start: number,
    end: number,
    issues: ValidationIssue[],
    metrics: ArcPressureArchitectureMetrics,
  ): void {
    const crisis = arc.lateArcCrisis;
    if (!crisis) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing lateArcCrisis.`,
        `${location}.lateArcCrisis`,
        'Add a late-arc crisis: apparent failure, irreversible cost, or collapse of the current plan.',
      ));
      return;
    }

    const crisisText = textFrom([crisis.apparentFailure, crisis.irreversibleCost, crisis.description]);
    if (!hasText(crisis.apparentFailure) || !hasText(crisis.irreversibleCost) || !hasText(crisis.description)) {
      issues.push(this.error(
        `Arc "${arc.name}" has an incomplete lateArcCrisis.`,
        `${location}.lateArcCrisis`,
        'Fill apparentFailure, irreversibleCost, and description.',
      ));
      return;
    }
    if (crisis.episodeNumber < start || crisis.episodeNumber > end) {
      issues.push(this.error(
        `Arc "${arc.name}" lateArcCrisis points outside the arc range.`,
        `${location}.lateArcCrisis.episodeNumber`,
      ));
    }
    const expected = Math.round(start + Math.max(1, end - start) * (2 / 3));
    if (Math.abs(crisis.episodeNumber - expected) > 1) {
      issues.push(this.warning(
        `Arc "${arc.name}" lateArcCrisis is far from the final third of the arc.`,
        `${location}.lateArcCrisis.episodeNumber`,
        'Keep the crisis near the 2/3 point unless the season 7-point spine requires otherwise.',
      ));
    }
    if (!CRISIS_LANGUAGE.test(crisisText)) {
      issues.push(this.warning(
        `Arc "${arc.name}" lateArcCrisis does not clearly read as apparent failure, irreversible cost, or collapse.`,
        `${location}.lateArcCrisis`,
      ));
    }
    metrics.arcsWithLateCrisis += 1;
  }

  private validateFinaleAndHandoff(
    arc: SeasonArc,
    totalEpisodes: number,
    location: string,
    issues: ValidationIssue[],
  ): void {
    if (!hasText(arc.finaleAnswer)) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing finaleAnswer.`,
        `${location}.finaleAnswer`,
        'State how the local arc question resolves.',
      ));
    }
    if (arc.episodeRange.end < totalEpisodes && !hasText(arc.handoffPressure)) {
      issues.push(this.error(
        `Arc "${arc.name}" ends before the season finale but has no handoffPressure.`,
        `${location}.handoffPressure`,
        'Resolve the arc question, then launch the next arc with residue, cost, reveal, or future pressure.',
      ));
    }
  }

  private validateTurnouts(
    arc: SeasonArc,
    location: string,
    issues: ValidationIssue[],
    metrics: ArcPressureArchitectureMetrics,
  ): void {
    const turnouts = Array.isArray(arc.episodeTurnouts) ? arc.episodeTurnouts : [];
    const expectedEpisodes = expectedArcEpisodes(arc);
    const covered = new Set(turnouts.map((turnout) => turnout.episodeNumber));
    const missing = expectedEpisodes.filter((episodeNumber) => !covered.has(episodeNumber));

    if (missing.length > 0) {
      issues.push(this.error(
        `Arc "${arc.name}" is missing episodeTurnouts for episode(s): ${missing.join(', ')}.`,
        `${location}.episodeTurnouts`,
        'Every episode in the arc needs an arc turn-out so episodes cannot be swapped without consequence.',
      ));
    }

    let complete = missing.length === 0 && turnouts.length > 0;
    for (const turnout of turnouts) {
      const turnoutLocation = `${location}.episodeTurnouts[${turnout.episodeNumber}]`;
      if (!VALID_TURNOUT_TYPES.has(turnout.turnType)) {
        issues.push(this.error(
          `Arc "${arc.name}" has invalid turnout type "${turnout.turnType}" for episode ${turnout.episodeNumber}.`,
          `${turnoutLocation}.turnType`,
        ));
        complete = false;
      }
      if (!expectedEpisodes.includes(turnout.episodeNumber)) {
        issues.push(this.error(
          `Arc "${arc.name}" has a turnout for episode ${turnout.episodeNumber}, outside the arc range.`,
          `${turnoutLocation}.episodeNumber`,
        ));
        complete = false;
      }
      if (!hasText(turnout.description) || !hasText(turnout.leavesProtagonistWith) || !hasText(turnout.whyThisCannotMoveLater)) {
        issues.push(this.error(
          `Arc "${arc.name}" has an incomplete turnout for episode ${turnout.episodeNumber}.`,
          turnoutLocation,
          'Fill description, leavesProtagonistWith, and whyThisCannotMoveLater.',
        ));
        complete = false;
      } else if (turnoutLooksFlat(turnout)) {
        issues.push(this.warning(
          `Arc "${arc.name}" episode ${turnout.episodeNumber} turnout may be simple chronology rather than consequence.`,
          turnoutLocation,
          'Turnouts should be escalation, reversal, discovery, cost, choice residue, crisis, finale, or handoff.',
        ));
      }
    }

    if (complete) {
      metrics.arcsWithCompleteTurnouts += 1;
    }
  }

  private result(
    issues: ValidationIssue[],
    metrics: ArcPressureArchitectureMetrics,
  ): ArcPressureArchitectureResult {
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 20 - warningCount * 5),
      issues,
      suggestions: [],
      metrics,
    };
  }
}
