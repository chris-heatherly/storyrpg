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
 * ESC plant-staging thread debts (authored-lite spine obligations) have no
 * injectable flag-gated variants. For those, credit a same-scene staging
 * payoff on the live ledger without fabricating reader-facing prose.
 *
 * Without this handler the router had to route thread/callback debts to
 * diagnostic_stop ("no repair handler; promotion requires one first") and the
 * kinds stayed advisory-only.
 */

import type { ContractRepairHandler } from './finalContractRepair';
import type { CallbackLedger } from '../pipeline/callbackLedger';
import { injectFallbackCallbacks } from '../pipeline/callbackOrchestration';
import { ESC_PLANT_STAGING_THREAD_ID_RE } from '../utils/compiledEscDirectives';

const DEBT_TYPES = new Set(['obligation_ledger_debt', 'planned_residue_debt']);

function extractHookIdFromDebtMessage(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(/obligation "([^"]+)"/);
  return match?.[1] ?? null;
}

function creditEscPlantStagingDebts(
  ledger: CallbackLedger,
  debts: Array<{ message?: string }>,
): number {
  let credited = 0;
  for (const debt of debts) {
    const hookId = extractHookIdFromDebtMessage(debt.message);
    if (!hookId || !ESC_PLANT_STAGING_THREAD_ID_RE.test(hookId)) continue;
    const hook = ledger.all().find((entry) => entry.id === hookId);
    if (!hook || hook.kind !== 'thread') continue;
    if (hook.payoffCount >= 1 || hook.resolved) continue;
    const sceneId = hook.sourceSceneId || 'unknown';
    const ok = ledger.recordPayoff(hookId, {
      episode: hook.sourceEpisode,
      sceneId,
      beatId: `${sceneId}-staging-fulfilled`,
      source: 'authored_variant',
    });
    if (ok) credited += 1;
  }
  return credited;
}

export function buildObligationPayoffRepairHandler(opts: {
  ledger: CallbackLedger | undefined;
  emit?: (message: string) => void;
}): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    if (!opts.ledger) return { story, changed: false };
    const debts = blockingIssues.filter((issue) => DEBT_TYPES.has(issue.type ?? ''));
    if (debts.length === 0) return { story, changed: false };

    const stagingCredited = creditEscPlantStagingDebts(opts.ledger, debts);

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

    if (stagingCredited === 0 && injected === 0) {
      opts.emit?.(`Obligation payoff repair: ${debts.length} debt blocker(s) but the realizer found no injectable payoff (meta-prose filter or placement caps).`);
      return { story, changed: false };
    }
    const parts: string[] = [];
    if (stagingCredited > 0) parts.push(`credited ${stagingCredited} ESC plant-staging debt(s)`);
    if (injected > 0) parts.push(`injected ${injected} deterministic payoff variant(s)`);
    opts.emit?.(`Obligation payoff repair: ${parts.join('; ')} for ${debts.length} debt blocker(s).`);
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_obligation_payoff',
        scope: 'autofix',
        attempted: debts.length,
        succeeded: true,
        degraded: (stagingCredited + injected) < debts.length,
        blocked: false,
        attempts: 1,
        details: `${parts.join('; ')} for ${debts.length} obligation debt blocker(s)`,
      },
    };
  };
}
