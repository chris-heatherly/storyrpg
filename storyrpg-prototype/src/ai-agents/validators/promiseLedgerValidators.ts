/**
 * Promise-ledger validators (Season Canon, Phase 2).
 *
 * These enforce the *explicit-target* promise contract: a promise (callback hook)
 * carries a specific `payoffEpisode`, and these gates fire only WHEN that target
 * is in play — never as a blanket "is everything resolved?" alarm. That's the
 * anti-false-alarm rule from the architecture: validate against generation state,
 * not absolute presence.
 *
 *   - promise-due:    a promise targeted at episode N must be paid IN episode N.
 *                     A promise targeted at N+2 is simply pending at N — not a
 *                     violation. Fires only for hooks whose payoffEpisode === N.
 *   - dangling-payoff: a payoff in the episode references a promise that doesn't
 *                     exist in the ledger. Always safe to check (never a false
 *                     alarm). Within-episode plant refs (`within-ep*`) are not
 *                     ledger hooks and are excluded.
 *   - plant-validity:  a promise with an explicit target must point strictly
 *                     forward and within the season: sourceEpisode < payoffEpisode
 *                     <= seasonLength. Catches vague/unreachable plants at plant
 *                     time so we never hit the finale owing a debt to a missing
 *                     episode.
 *
 * Pure functions over a CallbackLedger — unit-testable, no I/O. Wiring into the
 * per-episode gate is Phase 4 (the incremental seal/resume runner).
 */

import type { CallbackLedger, CallbackHook } from '../pipeline/callbackLedger';
import type { ValidationIssue, ValidationResult } from './BaseValidator';

/** Synthetic prompt-only callback ids that are never ledger hooks. */
function isIntraEpisodePlantRef(id: string): boolean {
  return id.startsWith('within-ep');
}

/** A promise is "satisfied" once it has been referenced (paid) at least once. */
function isPaid(hook: CallbackHook): boolean {
  return hook.resolved || hook.payoffCount > 0;
}

/**
 * promise-due: every promise explicitly targeted at `episode` must be paid in it.
 * Fires ONLY for hooks whose payoffEpisode === episode (so a later-targeted
 * promise is pending, not violated).
 */
export function validatePromisesDue(ledger: CallbackLedger, episode: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const hook of ledger.all()) {
    if (hook.payoffEpisode !== episode) continue;
    if (isPaid(hook)) continue;
    issues.push({
      severity: 'error',
      message: `Promise "${hook.summary}" (${hook.id}) was due to pay off in episode ${episode} but was never referenced.`,
      location: `promise:${hook.id}`,
      suggestion: `Author a payoff for this promise in episode ${episode} (a flag-conditional textVariant or choice keyed on ${hook.conditionKeys?.join(', ') || hook.flags.join(', ')}), or explicitly abandon it.`,
    });
  }
  return issues;
}

/**
 * dangling-payoff: every payoff reference in the episode must resolve to a real
 * ledger promise. `referencedHookIds` are the callbackHookId values found on the
 * episode's textVariants. Intra-episode plant refs are excluded (not ledger hooks).
 */
export function validateNoDanglingPayoffs(
  referencedHookIds: Iterable<string>,
  ledger: CallbackLedger,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const id of referencedHookIds) {
    if (!id || seen.has(id) || isIntraEpisodePlantRef(id)) continue;
    seen.add(id);
    if (!ledger.has(id)) {
      issues.push({
        severity: 'error',
        message: `Payoff references promise "${id}" which does not exist in the ledger.`,
        location: `payoff:${id}`,
        suggestion: 'Reference an existing open promise, or plant the promise before paying it off.',
      });
    }
  }
  return issues;
}

/**
 * plant-validity: every promise carrying an explicit payoffEpisode must target a
 * strictly-later episode within the season. `seasonLength` is the count of
 * planned episodes.
 */
export function validatePlantValidity(ledger: CallbackLedger, seasonLength: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const hook of ledger.withExplicitTarget()) {
    const target = hook.payoffEpisode as number;
    if (target <= hook.sourceEpisode) {
      issues.push({
        severity: 'error',
        message: `Promise "${hook.summary}" (${hook.id}) planted in episode ${hook.sourceEpisode} targets episode ${target}, which is not strictly later.`,
        location: `promise:${hook.id}`,
        suggestion: `Set payoffEpisode > ${hook.sourceEpisode}.`,
      });
    } else if (target > seasonLength) {
      issues.push({
        severity: 'error',
        message: `Promise "${hook.summary}" (${hook.id}) targets episode ${target}, beyond the season's ${seasonLength} episode(s).`,
        location: `promise:${hook.id}`,
        suggestion: `Set payoffEpisode <= ${seasonLength}, or extend the season.`,
      });
    }
  }
  return issues;
}

export interface PromiseLedgerGateInput {
  ledger: CallbackLedger;
  /** The episode being sealed (current episode). */
  episode: number;
  /** Total planned episodes in the season. */
  seasonLength: number;
  /** callbackHookId values referenced by this episode's textVariants. */
  referencedHookIds?: Iterable<string>;
}

/**
 * Combined state-scoped promise gate for the per-episode seal (Phase 4 wires it).
 * Returns a ValidationResult so it can merge into the existing contract path.
 */
export function validatePromiseLedger(input: PromiseLedgerGateInput): ValidationResult {
  const issues: ValidationIssue[] = [
    ...validatePlantValidity(input.ledger, input.seasonLength),
    ...validatePromisesDue(input.ledger, input.episode),
    ...validateNoDanglingPayoffs(input.referencedHookIds ?? [], input.ledger),
  ];
  return {
    valid: issues.every((i) => i.severity !== 'error'),
    score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20),
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => !!s),
  };
}
