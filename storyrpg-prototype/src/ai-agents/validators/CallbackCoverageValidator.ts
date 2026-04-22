// ========================================
// CALLBACK COVERAGE VALIDATOR
// ========================================
//
// Plan 1 (Witcher-style Delayed Consequences). This validator checks the
// CallbackLedger for hygiene issues AFTER an episode has been generated:
//
//   - Were hooks authored with non-empty summaries? (authoring quality)
//   - Did episodes 2+ actually pay off at least one hook?
//     (i.e. did SceneWriter produce a TextVariant with `callbackHookId`?)
//   - Are there unresolved hooks whose payoffWindow has closed? Those hooks
//     will never pay off — emit a warning so authors can either widen the
//     window or plan a payoff in the current episode.
//
// Scope: ledger-level structural checks. The *narrative* quality of callback
// prose is still the job of the existing CallbackOpportunitiesValidator.

import type { ValidationIssue } from '../../types/validation';
import type { CallbackHook, SerializedCallbackLedger } from '../pipeline/callbackLedger';

export interface CallbackCoverageInput {
  ledger: SerializedCallbackLedger;
  /** Current (most-recently-generated) episode number. */
  currentEpisode: number;
  /** Total episodes planned for the story. */
  totalEpisodes: number;
}

export interface CallbackCoverageResult {
  passed: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  metrics: {
    totalHooks: number;
    resolvedHooks: number;
    unresolvedHooks: number;
    hooksPaidOffThisEpisode: number;
    staleHooks: number; // unresolved + past maxEpisode
  };
}

export class CallbackCoverageValidator {
  validate(input: CallbackCoverageInput): CallbackCoverageResult {
    const hooks = input.ledger?.hooks ?? [];
    const issues: ValidationIssue[] = [];

    const resolvedHooks = hooks.filter((h) => h.resolved).length;
    const unresolvedHooks = hooks.length - resolvedHooks;

    // A hook "paid off this episode" means its payoffCount > 0 AND the current
    // episode falls within its window. We don't have per-episode payoff counts
    // in the ledger (only a total), so this check is a soft approximation:
    // we count hooks that were created in a PRIOR episode AND have payoffCount > 0.
    const hooksPaidOffThisEpisode = hooks.filter(
      (h) => h.sourceEpisode < input.currentEpisode && h.payoffCount > 0,
    ).length;

    const staleHooks = hooks.filter(
      (h) => !h.resolved && h.payoffWindow.maxEpisode < input.currentEpisode,
    );

    if (input.currentEpisode > 1 && hasEligibleHooks(hooks, input.currentEpisode) && hooksPaidOffThisEpisode === 0) {
      issues.push({
        category: 'callback_opportunities',
        level: 'warning',
        location: {},
        message:
          `Episode ${input.currentEpisode}: ${unresolvedHooks} unresolved callback hook(s) exist from prior ` +
          `episodes but no scene in this episode referenced any of them via textVariants. Consider adding a ` +
          `TextVariant with callbackHookId in at least one scene.`,
        suggestion: 'Author at least one TextVariant with `callbackHookId` pointing to an unresolved hook id.',
      });
    }

    for (const hook of staleHooks) {
      issues.push({
        category: 'callback_opportunities',
        level: 'suggestion',
        location: { sceneId: hook.sourceSceneId, choiceId: hook.sourceChoiceId },
        message:
          `Callback hook "${hook.id}" (from episode ${hook.sourceEpisode}) has expired without a payoff. ` +
          `Window was episodes ${hook.payoffWindow.minEpisode}-${hook.payoffWindow.maxEpisode}, ` +
          `current is episode ${input.currentEpisode}.`,
      });
    }

    for (const hook of hooks) {
      if (!hook.summary || hook.summary.trim().length < 10) {
        issues.push({
          category: 'callback_opportunities',
          level: 'warning',
          location: { sceneId: hook.sourceSceneId, choiceId: hook.sourceChoiceId },
          message:
            `Callback hook "${hook.id}" has a missing or too-short summary (${hook.summary?.length || 0} chars). ` +
            `Summaries are surfaced to players in recap UIs; aim for one sentence past-tense prose.`,
        });
      }
    }

    let score = 100;
    if (input.currentEpisode > 1) {
      const target = Math.min(unresolvedHooks, 2); // expect at least 2 payoffs per episode when possible
      if (target > 0) {
        const ratio = Math.min(1, hooksPaidOffThisEpisode / target);
        score = Math.round(ratio * 100);
      }
    }
    const staleFraction = hooks.length > 0 ? staleHooks.length / hooks.length : 0;
    score = Math.max(0, score - Math.round(staleFraction * 20));

    return {
      passed: issues.filter((i) => i.level === 'error').length === 0,
      score,
      issues,
      metrics: {
        totalHooks: hooks.length,
        resolvedHooks,
        unresolvedHooks,
        hooksPaidOffThisEpisode,
        staleHooks: staleHooks.length,
      },
    };
  }
}

function hasEligibleHooks(hooks: CallbackHook[], episode: number): boolean {
  return hooks.some(
    (h) => !h.resolved && h.payoffWindow.minEpisode <= episode && h.payoffWindow.maxEpisode >= episode,
  );
}
