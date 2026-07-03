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
 *                     alarm). Refs that are not ledger hooks by construction are
 *                     excluded: within-episode plant refs (`within-ep*`) and
 *                     structural-flag refs (`treatment_branch_`/`route_`/`tint:`),
 *                     which the ledger never registers (see `isNonLedgerRef`).
 *   - plant-validity:  a promise with an explicit target must not point BACKWARD and
 *                     must stay within the season: sourceEpisode <= payoffEpisode <=
 *                     seasonLength. A same-episode target is valid (a within-episode
 *                     forward promise, paid off in a later scene of its own episode;
 *                     promise-due enforces the payment). Catches only backward /
 *                     beyond-season plants so we never owe a debt to an impossible
 *                     episode.
 *
 * Pure functions over a CallbackLedger — unit-testable, no I/O. Wiring into the
 * per-episode gate is Phase 4 (the incremental seal/resume runner).
 */

import { isStructuralFlag, type CallbackLedger, type CallbackHook } from '../pipeline/callbackLedger';
import type { ValidationIssue, ValidationResult } from './BaseValidator';

/**
 * Callback ids that are NEVER ledger hooks, so a payoff referencing one is not a
 * dangling cross-episode promise — it's a different (harmless) class of mislabel:
 *  - `within-ep*`: synthetic prompt-only intra-episode plant refs.
 *  - structural flags (`treatment_branch_`/`route_`/`tint:`): the ledger excludes
 *    these by construction (CallbackLedger.recordFlagSet). A branch-axis flag is
 *    paid off by the branch + reconvergence residue (a textVariant gated on the
 *    flag), not by a callback line, so a `callbackHookId` pointing at one can never
 *    resolve and must not abort the Season Canon seal.
 */
function isNonLedgerRef(id: string): boolean {
  return id.startsWith('within-ep') || isStructuralFlag(id);
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
    if (isPaid(hook) || hook.abandoned) continue;
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
  for (const rawId of referencedHookIds) {
    // Canonicalize a bare `flag`/`score` name to its planted `flag:`/`score:` hook
    // so a missing prefix on an otherwise-valid payoff isn't a dangling reference.
    const id = ledger.resolveHookId(rawId);
    if (!id || seen.has(id) || isNonLedgerRef(id)) continue;
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
 * plant-validity: every promise carrying an explicit payoffEpisode must target its
 * OWN or a later episode within the season (never earlier). A same-episode target is a
 * valid within-episode forward promise (promise-due enforces it pays off in that
 * episode). `seasonLength` is the count of planned episodes.
 */
export function validatePlantValidity(ledger: CallbackLedger, seasonLength: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const hook of ledger.withExplicitTarget()) {
    const target = hook.payoffEpisode as number;
    if (target < hook.sourceEpisode) {
      // BACKWARD only. A same-episode target (target === sourceEpisode) is a valid
      // WITHIN-EPISODE forward promise — set up in an early scene, paid off in a later
      // scene of the SAME episode (e.g. "when Victor finally sits across from her in the
      // booth…"). It is NOT a plant-validity error: `validatePromisesDue` already
      // requires it to be paid off within its own episode, so enforcement lives there.
      // Only a promise pointing EARLIER than its plant episode is genuinely impossible.
      issues.push({
        severity: 'error',
        message: `Promise "${hook.summary}" (${hook.id}) planted in episode ${hook.sourceEpisode} targets episode ${target}, which is earlier than its plant episode — a promise cannot pay off before it is made.`,
        location: `promise:${hook.id}`,
        suggestion: `Set payoffEpisode >= ${hook.sourceEpisode}.`,
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

/**
 * season-completion: when ALL planned episodes are sealed, every promise must be
 * paid (resolved) or explicitly abandoned — nothing silently left open. This is a
 * formality if promise-due held each episode, but it's the season-level safety net.
 * Runs only at season end (the caller decides when all episodes are sealed).
 */
export function validateSeasonCompletion(ledger: CallbackLedger): ValidationIssue[] {
  return ledger.stillOpen().map((hook) => ({
    severity: 'error' as const,
    message: `Promise "${hook.summary}" (${hook.id}) is still open at season end — never paid off or abandoned.`,
    location: `promise:${hook.id}`,
    suggestion: hook.payoffEpisode
      ? `It was targeted at episode ${hook.payoffEpisode}; author its payoff there or abandon it with a reason.`
      : 'Pay it off in a later episode or abandon it with a reason.',
  }));
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
