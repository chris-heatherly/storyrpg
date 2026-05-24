import type { CharacterArchitecture } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface CharacterArchitectureMetrics {
  hasArchitecture: boolean;
  supportingMicroArcCount: number;
  arcsLinkedToIdentityPressure: number;
}

export interface CharacterArchitectureResult extends ValidationResult {
  metrics: CharacterArchitectureMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const AGENCY_TERMS = /\b(choose|chooses|choice|decide|refuse|sacrifice|commit|reveal|use|spend|risk|admit|protect|betray|claim|accept|reject|confront|act)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function tokenSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3)
  );
}

function overlapRatio(a: string | undefined, b: string | undefined): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(3, Math.min(left.size, right.size));
}

export class CharacterArchitectureValidator extends BaseValidator {
  constructor() {
    super('CharacterArchitectureValidator');
  }

  validate(input: {
    characterArchitecture?: CharacterArchitecture;
    plan?: Pick<SeasonPlan, 'arcs' | 'episodes' | 'totalEpisodes'>;
  }): CharacterArchitectureResult {
    const issues: ValidationIssue[] = [];
    const architecture = input.characterArchitecture;
    const metrics: CharacterArchitectureMetrics = {
      hasArchitecture: Boolean(architecture),
      supportingMicroArcCount: architecture?.supportingCharacters?.length || 0,
      arcsLinkedToIdentityPressure: 0,
    };

    if (!architecture) {
      issues.push(this.error(
        'Character architecture is missing.',
        'characterArchitecture',
        'Add protagonist Lie/origin pressure/Truth/Want/Need/climax choice architecture.',
      ));
      return this.result(issues, metrics);
    }

    this.validateProtagonist(architecture, issues);
    this.validateSupportingMicroArcs(architecture, issues);
    this.validateArcAlignment(architecture, input.plan, issues, metrics);

    return this.result(issues, metrics);
  }

  private validateProtagonist(
    architecture: CharacterArchitecture,
    issues: ValidationIssue[],
  ): void {
    const protagonist = architecture.protagonist;
    if (!protagonist) {
      issues.push(this.error('characterArchitecture.protagonist is missing.', 'characterArchitecture.protagonist'));
      return;
    }

    for (const field of ['lie', 'originPressure', 'truth', 'want', 'need'] as const) {
      if (!hasText(protagonist[field])) {
        issues.push(this.error(
          `Protagonist characterArchitecture.${field} is missing.`,
          `characterArchitecture.protagonist.${field}`,
        ));
      }
    }

    if (hasText(protagonist.want) && hasText(protagonist.need) && overlapRatio(protagonist.want, protagonist.need) >= 0.6) {
      issues.push(this.warning(
        'Protagonist Want and Need appear too similar.',
        'characterArchitecture.protagonist.want/need',
        'The Want should be the conscious goal; the Need should create a meaningful dramatic gap.',
      ));
    }

    if (!['positive', 'tragic', 'ambiguous'].includes(protagonist.arcMode)) {
      issues.push(this.error(
        `Invalid protagonist arcMode "${protagonist.arcMode}".`,
        'characterArchitecture.protagonist.arcMode',
      ));
    }

    const climax = protagonist.climaxChoice;
    if (!climax) {
      issues.push(this.error(
        'Protagonist climaxChoice is missing.',
        'characterArchitecture.protagonist.climaxChoice',
      ));
      return;
    }
    for (const field of ['choiceQuestion', 'integrateTruthOption', 'recommitLieOption', 'activeChoiceMechanism'] as const) {
      if (!hasText(climax[field])) {
        issues.push(this.error(
          `Protagonist climaxChoice.${field} is missing.`,
          `characterArchitecture.protagonist.climaxChoice.${field}`,
        ));
      }
    }
    const activeChoiceText = [
      climax.choiceQuestion,
      climax.integrateTruthOption,
      climax.recommitLieOption,
      climax.activeChoiceMechanism,
    ].join(' ');
    if (hasText(activeChoiceText) && !AGENCY_TERMS.test(activeChoiceText)) {
      issues.push(this.warning(
        'Protagonist climaxChoice does not clearly describe an active choice.',
        'characterArchitecture.protagonist.climaxChoice',
        'The climax should resolve through player/protagonist action: sacrifice, refusal, revelation, commitment, risk, or relationship leverage.',
      ));
    }
  }

  private validateSupportingMicroArcs(
    architecture: CharacterArchitecture,
    issues: ValidationIssue[],
  ): void {
    for (const microArc of architecture.supportingCharacters || []) {
      const location = `characterArchitecture.supportingCharacters.${microArc.characterId || microArc.characterName}`;
      if (microArc.screenTimeTier === 'minor') {
        issues.push(this.warning(
          `Minor character "${microArc.characterName}" has a micro-Lie; keep this scaled down.`,
          location,
          'Only core/supporting characters should carry substantial micro-arc pressure.',
        ));
      }
      if (!hasText(microArc.microLie)) {
        issues.push(this.error(`Supporting character "${microArc.characterName}" is missing microLie.`, `${location}.microLie`));
      }
      if (!hasText(microArc.truthOrCounterPressure)) {
        issues.push(this.error(
          `Supporting character "${microArc.characterName}" is missing truthOrCounterPressure.`,
          `${location}.truthOrCounterPressure`,
        ));
      }
      if (!Array.isArray(microArc.protagonistVisibleSignals) || microArc.protagonistVisibleSignals.length === 0) {
        issues.push(this.error(
          `Supporting character "${microArc.characterName}" is missing protagonistVisibleSignals.`,
          `${location}.protagonistVisibleSignals`,
          'Micro-Lies must surface through behavior the protagonist can observe or interpret.',
        ));
      }
    }
  }

  private validateArcAlignment(
    architecture: CharacterArchitecture,
    plan: Pick<SeasonPlan, 'arcs' | 'episodes' | 'totalEpisodes'> | undefined,
    issues: ValidationIssue[],
    metrics: CharacterArchitectureMetrics,
  ): void {
    if (!plan?.arcs?.length) return;
    const protagonist = architecture.protagonist;
    for (const arc of plan.arcs) {
      if (!hasText(arc.identityPressureFacet)) {
        issues.push(this.error(
          `Arc "${arc.name}" is missing identityPressureFacet for character architecture alignment.`,
          `season.arcs.${arc.id}.identityPressureFacet`,
        ));
        continue;
      }
      const linked = Math.max(
        overlapRatio(arc.identityPressureFacet, protagonist.lie),
        overlapRatio(arc.identityPressureFacet, protagonist.truth),
        overlapRatio(arc.identityPressureFacet, protagonist.need),
      );
      if (linked > 0) {
        metrics.arcsLinkedToIdentityPressure += 1;
      } else {
        issues.push(this.warning(
          `Arc "${arc.name}" identityPressureFacet does not obviously connect to the protagonist Lie/Truth/Need.`,
          `season.arcs.${arc.id}.identityPressureFacet`,
          'Arc pressure should make the protagonist false belief harder to sustain or the Truth harder to avoid.',
        ));
      }
    }
  }

  private result(
    issues: ValidationIssue[],
    metrics: CharacterArchitectureMetrics,
  ): CharacterArchitectureResult {
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
