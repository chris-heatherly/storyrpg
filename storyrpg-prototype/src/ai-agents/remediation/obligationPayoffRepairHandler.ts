/**
 * Deterministic obligation-payoff repair (criteria-reduction, 2026-07-03).
 *
 * The repair handler that unlocks the non-residue blocking promotion: when the
 * final contract blocks on unpaid thread/callback obligation debt
 * (`obligation_ledger_debt` from the unified ObligationLedgerValidator), re-run
 * the auto-callback realizer (`injectFallbackCallbacks`) over the assembled
 * story. The realizer appends flag-gated TextVariants sourced from authored
 * choice metadata (reminderPlan / echoSummary / ledger prose) — deterministic,
 * no LLM — and credits `ledger.recordPayoff` on the LIVE ledger, which the
 * final-contract loop re-serializes per revalidation round, so paid debts
 * clear on the next pass.
 *
 * Without this handler the router had to route thread/callback debts to
 * diagnostic_stop ("no repair handler; promotion requires one first") and the
 * kinds stayed advisory-only.
 */

import type { ContractRepairHandler } from './finalContractRepair';
import type { CallbackLedger } from '../pipeline/callbackLedger';
import { injectFallbackCallbacks } from '../pipeline/callbackOrchestration';

const DEBT_TYPES = new Set(['obligation_ledger_debt', 'planned_residue_debt']);

export function buildObligationPayoffRepairHandler(opts: {
  ledger: CallbackLedger | undefined;
  emit?: (message: string) => void;
}): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    if (!opts.ledger) return { story, changed: false };
    const debts = blockingIssues.filter((issue) => DEBT_TYPES.has(issue.type ?? ''));
    if (debts.length === 0) return { story, changed: false };

    let injected = 0;
    for (const episode of story.episodes ?? []) {
      const episodeNumber = episode.number;
      if (typeof episodeNumber !== 'number') continue;
      // Beats are shared by reference, so the realizer's TextVariant appends
      // land directly on the caller's story.
      const sceneContents = (episode.scenes ?? []).map((scene) => ({
        sceneId: scene.id,
        beats: (scene.beats ?? []) as never[],
      }));
      const result = injectFallbackCallbacks(opts.ledger, {
        episodeNumber,
        sceneContents: sceneContents as never,
        choiceSets: [],
      });
      injected += result.injected;
    }

    if (injected === 0) {
      opts.emit?.(`Obligation payoff repair: ${debts.length} debt blocker(s) but the realizer found no injectable payoff (meta-prose filter or placement caps).`);
      return { story, changed: false };
    }
    opts.emit?.(`Obligation payoff repair: injected ${injected} deterministic payoff variant(s) for ${debts.length} debt blocker(s).`);
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_obligation_payoff',
        scope: 'autofix',
        attempted: debts.length,
        succeeded: true,
        degraded: injected < debts.length,
        blocked: false,
        attempts: 1,
        details: `Injected ${injected} fallback payoff variant(s) for ${debts.length} obligation debt blocker(s)`,
      },
    };
  };
}
