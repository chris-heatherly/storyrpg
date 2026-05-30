/**
 * MechanicsLeakageValidator
 *
 * Flags player-facing prose that exposes raw mechanics. This is a heuristic
 * backstop for the fiction-first contract; it intentionally ignores authored
 * code/config strings and should be run only on rendered story text.
 */

import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface MechanicsLeakageText {
  id: string;
  text: string;
  sceneId?: string;
  beatId?: string;
}

export interface MechanicsLeakageInput {
  texts: MechanicsLeakageText[];
}

export interface MechanicsLeakageResult extends ValidationResult {
  metrics: {
    textsChecked: number;
    leaksFound: number;
  };
}

const LEAK_PATTERNS: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
  {
    // NOTE: bare "roll"/"rolled" are common physical action verbs ("roll to
    // safety", "rolled away") — false-positives that hard-block real stories.
    // Qualify them to their RPG sense: followed by a die expression or the
    // words "for/a/the" preceding a check. "dice", "d20", etc. are unambiguous.
    pattern: /\b(?:roll(?:ed)?\s+(?:a\s+)?(?:d\d+|dice|check|for\s+\w+)|dice|d20|d12|d10|d8|d6|d4)\b/i,
    label: 'dice language',
    suggestion: 'Describe uncertainty and outcome through action, tension, and consequence instead of dice.',
  },
  {
    pattern: /\b(?:DC|difficulty\s*class|check\s*(?:failed|succeeded|success|failure)|saving throw)\b/i,
    label: 'check/threshold language',
    suggestion: 'Replace checks and thresholds with fictional affordances, pressure, or limits.',
  },
  {
    // NOTE: the optimization terms must stay RPG-specific. Bare "build",
    // "bonus", and "modifier" are ordinary English ("mortals build and fall",
    // "a welcome bonus") and false-positive on fiction-first prose, hard-failing
    // the whole story at the final contract. Qualify them to their mechanical
    // sense; "+N bonus" is still caught by the numeric-stat-delta pattern below.
    pattern: /\b(?:skill\s*check|level requirement|character\s+build|(?:stat|skill|attribute)\s+(?:modifier|bonus)|success chance|failure chance)\b/i,
    label: 'player-facing optimization language',
    suggestion: 'Describe capability through what the character notices, risks, or can lean on in the fiction.',
  },
  {
    pattern: /(?:\b(?:XP|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)\s*)?(?:\+|\-)\s?\d+\s*(?:XP|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)?\b/i,
    label: 'numeric stat delta',
    suggestion: 'Show the visible relationship, identity, or resource shift without numeric deltas.',
  },
  {
    pattern: /\b(?:threshold|score|stat|skill|attribute)\s+(?:is|must be|needs to be|>=|<=|above|below|must be \d+\s+or\s+(?:above|below))\s*\d*\b/i,
    label: 'raw threshold',
    suggestion: 'Turn raw thresholds into fiction-first locked reasons or character perception.',
  },
  {
    pattern: /\b\d+%|\b(?:odds|probability|chance)\s+(?:of|to)\s+(?:success|succeed|fail)\b/i,
    label: 'probability language',
    suggestion: 'Express likelihood as story risk, leverage, preparation, or desperation.',
  },
];

export class MechanicsLeakageValidator extends BaseValidator {
  constructor() {
    super('MechanicsLeakageValidator');
  }

  validate(input: MechanicsLeakageInput): MechanicsLeakageResult {
    const issues: ValidationIssue[] = [];

    for (const item of input.texts) {
      for (const check of LEAK_PATTERNS) {
        if (!check.pattern.test(item.text)) continue;
        const location = [item.sceneId, item.beatId, item.id].filter(Boolean).join(':') || item.id;
        issues.push(this.warning(
          `Player-facing text "${item.id}" exposes ${check.label}.`,
          location,
          check.suggestion,
        ));
      }
    }

    const leaksFound = issues.length;
    return {
      valid: leaksFound === 0,
      score: Math.max(0, 100 - leaksFound * 12),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        textsChecked: input.texts.length,
        leaksFound,
      },
    };
  }
}
