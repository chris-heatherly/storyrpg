import type { ThemeArgumentContract } from '../../types/sourceAnalysis';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface ThemeArgumentContractInput {
  themeArgument?: ThemeArgumentContract;
}

export interface ThemeArgumentContractMetrics {
  hasContract: boolean;
  missingFieldCount: number;
  duplicateValueCount: number;
}

export interface ThemeArgumentContractResult extends ValidationResult {
  metrics: ThemeArgumentContractMetrics;
}

const GENERIC_VALUE = /\b(theme|story|change|conflict|journey|growth|good|evil)\b/i;

export class ThemeArgumentContractValidator extends BaseValidator {
  constructor() {
    super('ThemeArgumentContractValidator');
  }

  validate(input: ThemeArgumentContractInput): ThemeArgumentContractResult {
    const issues: ValidationIssue[] = [];
    const contract = input.themeArgument;

    if (!contract) {
      issues.push(this.error(
        'Missing themeArgument contract.',
        'themeArgument',
        'Populate one generator-only ThemeArgumentContract from source analysis.',
      ));
      return result(issues, { hasContract: false, missingFieldCount: 1, duplicateValueCount: 0 });
    }

    const required: Array<[string, unknown]> = [
      ['themeQuestion', contract.themeQuestion],
      ['controllingIdea.value', contract.controllingIdea?.value],
      ['controllingIdea.cause', contract.controllingIdea?.cause],
      ['controllingIdea.sentence', contract.controllingIdea?.sentence],
      ['counterIdea.value', contract.counterIdea?.value],
      ['counterIdea.cause', contract.counterIdea?.cause],
      ['counterIdea.sentence', contract.counterIdea?.sentence],
      ['valueLadder.positive', contract.valueLadder?.positive],
      ['valueLadder.contrary', contract.valueLadder?.contrary],
      ['valueLadder.contradiction', contract.valueLadder?.contradiction],
      ['valueLadder.negationOfNegation', contract.valueLadder?.negationOfNegation],
      ['archetypalCore', contract.archetypalCore],
      ['uniqueSurface', contract.uniqueSurface],
      ['climaxResonantEvent', contract.climaxResonantEvent],
      ['retroactiveReframe', contract.retroactiveReframe],
      ['aestheticEmotionTarget', contract.aestheticEmotionTarget],
    ];

    for (const [field, value] of required) {
      if (!text(value)) {
        issues.push(this.error(
          `Theme argument field "${field}" is empty.`,
          field,
          'Fill this field with a concrete, story-specific sentence.',
        ));
      }
    }

    if (contract.themeQuestion && !contract.themeQuestion.includes('?')) {
      issues.push(this.warning(
        'themeQuestion is not phrased as a question.',
        'themeQuestion',
        'Rewrite it as a playable question answerable by protagonist/player action.',
      ));
    }

    if (sameText(contract.controllingIdea?.sentence, contract.counterIdea?.sentence)) {
      issues.push(this.error(
        'controllingIdea and counterIdea are effectively identical.',
        'themeArgument',
        'Make the counter-idea a genuinely persuasive opposing argument.',
      ));
    }

    const ladder = [
      contract.valueLadder?.positive,
      contract.valueLadder?.contrary,
      contract.valueLadder?.contradiction,
      contract.valueLadder?.negationOfNegation,
    ].map(normalize);
    const duplicateValueCount = ladder.length - new Set(ladder.filter(Boolean)).size;
    if (duplicateValueCount > 0) {
      issues.push(this.warning(
        'The value ladder repeats one or more rung descriptions.',
        'valueLadder',
        'Each rung should name a distinct dramatic state.',
      ));
    }

    for (const [field, value] of [
      ['controllingIdea.value', contract.controllingIdea?.value],
      ['counterIdea.value', contract.counterIdea?.value],
      ['valueLadder.positive', contract.valueLadder?.positive],
    ] as const) {
      if (text(value) && GENERIC_VALUE.test(text(value))) {
        issues.push(this.info(
          `Theme argument field "${field}" is generic.`,
          field,
          'Prefer a specific value such as loyalty, selfhood, mercy, belonging, freedom, or trust.',
        ));
      }
    }

    const missingFieldCount = required.filter(([, value]) => !text(value)).length;
    return result(issues, { hasContract: true, missingFieldCount, duplicateValueCount });
  }
}

function result(issues: ValidationIssue[], metrics: ThemeArgumentContractMetrics): ThemeArgumentContractResult {
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

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function sameText(a: unknown, b: unknown): boolean {
  const aa = normalize(a);
  const bb = normalize(b);
  return Boolean(aa && bb && aa === bb);
}
