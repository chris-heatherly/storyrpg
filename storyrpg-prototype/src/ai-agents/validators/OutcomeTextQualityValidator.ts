import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

/**
 * Outcome-text quality (G10).
 *
 * A choice's `outcomeTexts` (success / partial / failure) must be authored fiction-first
 * prose — not a stub that restates the stakes annotation or leaks authoring scaffolding.
 * G10 shipped choices whose tiers were the old ChoiceAuthor fallback:
 *   success: "It works — you get what you reached for: <want>."
 *   partial: "You get part of what you wanted, but it costs you: <cost>."
 *   failure: "It slips away from you, and <cost>."
 * — with lowercased proper nouns ("victor gets a post…"). That fallback is fixed, but
 * this validator is the durable backstop: it flags any residual stub regardless of how
 * it was produced. Deterministic, no LLM.
 *
 * Flags, per tier:
 *   - SCAFFOLD: matches a known authoring-scaffold lead-in;
 *   - ECHO: the tier text is (almost) entirely the choice's `want`/`cost` annotation;
 *   - DUPLICATE: two tiers are identical after normalization, or a tier equals the
 *     choice prompt;
 *   - LOWERCASE_NAME: a sentence-initial token is a lowercased known proper noun.
 */

export interface OutcomeTextQualityInput {
  story: Story;
  /** Known proper nouns (NPC names, locations) for the lowercase-name check. */
  properNouns?: string[];
}

const SCAFFOLD_RE =
  /\b(?:it works\s*[—–-]\s*you get what you reached for|you get part of what you wanted, but it costs you|it slips away from you, and\b)/i;

function norm(s: string | undefined): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when `tier` is largely just the stakes annotation `ann` (echo stub). */
function isEcho(tier: string, ann: string | undefined): boolean {
  const a = norm(ann);
  if (a.length < 12) return false; // too short to judge
  const t = norm(tier);
  if (!t) return false;
  // The tier contains the whole annotation, and adds little of its own.
  return t.includes(a) && t.length <= a.length + 24;
}

interface ChoiceLike {
  id?: string;
  text?: string;
  stakes?: { want?: string; cost?: string };
  outcomeTexts?: { success?: string; partial?: string; failure?: string };
}

export class OutcomeTextQualityValidator extends BaseValidator {
  constructor() {
    super('OutcomeTextQualityValidator');
  }

  validate(input: OutcomeTextQualityInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const nouns = (input.properNouns || []).filter((n) => n && /^[A-Z]/.test(n));
    // sentence-initial lowercased proper noun, e.g. "victor gets a post"
    const lowerNameRes = nouns.map(
      (n) => new RegExp(`(^|[.!?]\\s+)(${n.toLowerCase()})\\b`),
    );

    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.outcomeTexts && typeof obj.outcomeTexts === 'object') {
        this.checkChoice(obj as ChoiceLike, lowerNameRes, issues);
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(input.story);

    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.length - errors;
    const score = Math.max(0, 100 - errors * 15 - warnings * 4);
    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }

  private checkChoice(
    choice: ChoiceLike,
    lowerNameRes: RegExp[],
    issues: ValidationIssue[],
  ): void {
    const ot = choice.outcomeTexts;
    if (!ot) return;
    const where = choice.id || '(choice)';
    const tiers: Array<['success' | 'partial' | 'failure', string | undefined]> = [
      ['success', ot.success],
      ['partial', ot.partial],
      ['failure', ot.failure],
    ];
    const label = norm(choice.text);
    const normed: Record<string, string> = {};

    for (const [tier, value] of tiers) {
      if (!value || !value.trim()) {
        issues.push(this.error(
          `Choice "${where}" outcomeTexts.${tier} is empty.`,
          where,
          'Author a 1–3 sentence fiction-first outcome for every tier.',
        ));
        continue;
      }
      normed[tier] = norm(value);

      if (SCAFFOLD_RE.test(value)) {
        issues.push(this.error(
          `Choice "${where}" outcomeTexts.${tier} leaks an authoring-scaffold stub: "${value.slice(0, 80)}".`,
          where,
          'Replace with authored fiction-first prose; do not restate the stakes annotation behind "you get what you reached for"/"it slips away from you".',
        ));
        continue;
      }

      const ann = tier === 'success' ? choice.stakes?.want : choice.stakes?.cost;
      if (isEcho(value, ann)) {
        issues.push(this.error(
          `Choice "${where}" outcomeTexts.${tier} just restates the stakes ${tier === 'success' ? 'want' : 'cost'} annotation: "${value.slice(0, 80)}".`,
          where,
          'Dramatize the outcome as a scene moment; do not paste the want/cost annotation as prose.',
        ));
        continue;
      }

      for (const re of lowerNameRes) {
        const m = re.exec(value);
        if (m) {
          issues.push(this.warning(
            `Choice "${where}" outcomeTexts.${tier} starts a sentence with a lowercased proper noun ("${m[2]}") — reads as un-proofed template output.`,
            where,
            'Capitalize proper nouns; this is a tell of interpolated fallback text.',
          ));
          break;
        }
      }
    }

    // Cross-tier duplication / equals-prompt.
    const pairs: Array<['success' | 'partial' | 'failure', 'success' | 'partial' | 'failure']> = [
      ['success', 'partial'],
      ['success', 'failure'],
      ['partial', 'failure'],
    ];
    for (const [a, b] of pairs) {
      if (normed[a] && normed[a] === normed[b]) {
        issues.push(this.error(
          `Choice "${where}" outcomeTexts.${a} and .${b} are identical — tiers must read differently.`,
          where,
          'Differentiate the success/partial/failure prose so each tier depicts a distinct result.',
        ));
      }
    }
    for (const [tier, value] of tiers) {
      if (value && label && norm(value) === label) {
        issues.push(this.error(
          `Choice "${where}" outcomeTexts.${tier} is identical to the choice prompt.`,
          where,
          'Outcome prose must depict the result, not echo the option label.',
        ));
      }
    }
  }
}
