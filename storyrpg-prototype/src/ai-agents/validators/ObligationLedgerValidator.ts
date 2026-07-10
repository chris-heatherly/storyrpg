/**
 * Unified obligation-ledger validator (audit item 2, P2.4).
 *
 * One per-kind check over the unified ledger, replacing the question five
 * validators each asked of their own bookkeeping ("was the promise kept in
 * its window?"). Findings are tagged with the EXISTING gate ids — no gate
 * renames, so remediation-ledger telemetry stays continuous:
 *
 *   thread        -> GATE_SETUP_PAYOFF
 *   seed          -> GATE_TREATMENT_SEED_ONPAGE
 *   residue       -> GATE_RESIDUE_CONSUME
 *   everything else (choice_callback / flag_promise / score_promise / tone /
 *   forward_promise) -> GATE_CALLBACK_COVERAGE
 *
 * STATUS (flip live, 2026-07-03 — commits fec133ca / aac079b1 / 195dd24c):
 * this is the authoritative source at the final contract. `FinalStoryContract`
 * runs `validateObligationLedger` and routes findings under the gate ids above,
 * replacing ResidueObligationValidator's final-contract dispatch; the plan-time
 * GATE_SETUP_PAYOFF / GATE_CALLBACK_COVERAGE gates also read it. Per-kind
 * BLOCKING still follows the normal per-gate flags (`isGateEnabledAt(gate,
 * 'season-final')`) — that is standard gate policy, not shadow mode. Two things
 * still run alongside it: the per-episode diagnostic (episode-N-obligation-
 * ledger.json) and ResidueObligationValidator's episode-time quick-validation
 * half (prose-evidence detection the ledger does not replicate).
 */

import type { CallbackHook, CallbackLedger, ObligationKind } from '../pipeline/callbackLedger';
import { isObligationPaid } from '../pipeline/obligationSeeding';

export interface ObligationLedgerFinding {
  gateId: string;
  kind: ObligationKind;
  hookId: string;
  severity: 'error' | 'warning';
  message: string;
  sourceEpisode: number;
  dueByEpisode: number;
}

export interface ObligationLedgerReport {
  episodeNumber: number;
  totalObligations: number;
  open: number;
  paid: number;
  abandoned: number;
  findings: ObligationLedgerFinding[];
}

const GATE_BY_KIND: Partial<Record<ObligationKind, string>> = {
  thread: 'GATE_SETUP_PAYOFF',
  seed: 'GATE_TREATMENT_SEED_ONPAGE',
  residue: 'GATE_RESIDUE_CONSUME',
};

function gateFor(kind: ObligationKind | undefined): string {
  return (kind && GATE_BY_KIND[kind]) || 'GATE_CALLBACK_COVERAGE';
}

/** Kind-aware "kept" check: tone hooks are best-effort and never findings. */
function isKept(hook: CallbackHook): boolean {
  if (hook.resolved || hook.abandoned) return true;
  if (isObligationPaid(hook)) return true;
  // Legacy promise semantics (promiseLedgerValidators.isPaid): any credit counts.
  return hook.payoffCount > 0;
}

export function validateObligationLedger(
  ledger: CallbackLedger,
  params: { episodeNumber: number; generatedThroughEpisode: number },
): ObligationLedgerReport {
  const hooks = ledger.serialize().hooks;
  const { episodeNumber, generatedThroughEpisode } = params;
  const findings: ObligationLedgerFinding[] = [];
  let open = 0;
  let paid = 0;
  let abandoned = 0;

  for (const hook of hooks) {
    if (hook.abandoned) {
      abandoned += 1;
      continue;
    }
    // CREATION-side check (shadow-run finding, bite-me 2026-07-03T03-29-57):
    // a residue obligation seeded with NO setting choice (P2.2 marks these
    // with an empty sourceChoiceId) whose origin episode has been generated
    // means the planned flag was never authored — the legacy
    // ResidueObligationValidator's "did not create flag" class. Checked
    // before paid-ness: an auto-injected payoff can credit the hook while
    // the choice-side flag still doesn't exist.
    //
    // Treatment consequence chains (`consequence_*`) are load-bearing: promote
    // to error so final contract can block seal under GATE_RESIDUE_CONSUME /
    // treatmentSourced. Other residue stays advisory (warning) to avoid
    // over-blocking soft residue that the seal may abandon.
    if (hook.kind === 'residue' && !hook.sourceChoiceId && hook.sourceEpisode <= episodeNumber) {
      const isTreatmentChain = (hook.flags ?? []).some((flag) =>
        typeof flag === 'string' && flag.startsWith('consequence_')
      ) || /^flag:consequence_/.test(hook.id);
      findings.push({
        gateId: gateFor(hook.kind),
        kind: 'residue',
        hookId: hook.id,
        severity: isTreatmentChain ? 'error' : 'warning',
        message:
          `residue obligation "${hook.id}" (${hook.summary}) was planned to originate in episode ${hook.sourceEpisode} ` +
          `but no choice creates its flag.`,
        sourceEpisode: hook.sourceEpisode,
        dueByEpisode: hook.payoffEpisode ?? hook.payoffWindow.maxEpisode,
      });
    }
    if (isKept(hook)) {
      paid += 1;
      continue;
    }
    open += 1;
    if (hook.kind === 'tone') continue; // best-effort tier, never a finding
    const dueBy = hook.payoffEpisode ?? hook.payoffWindow.maxEpisode;
    if (dueBy > episodeNumber) continue; // not yet due
    // Due (or overdue). Error when the due window closed inside the generated
    // slice; warning when later generated episodes could still pay it.
    const windowClosedInSlice = dueBy <= generatedThroughEpisode;
    // Dead-promise demotion (mirrors the canon seal's auto-abandon sweep,
    // 966b03d4): a FLAG-GATED promise no choice ever creates can never display
    // a payoff at runtime, so it must never escalate to a blocking error —
    // the seal abandons it with a warning downstream. Threads pay by prose
    // reference (not flag state), so an empty sourceChoiceId is normal there
    // and keeps full severity.
    const flagGated = hook.kind !== 'thread'; // tone already excluded above
    const deadPromise = flagGated && !hook.sourceChoiceId;
    findings.push({
      gateId: gateFor(hook.kind),
      kind: hook.kind ?? 'choice_callback',
      hookId: hook.id,
      severity: !deadPromise && windowClosedInSlice && dueBy <= episodeNumber ? 'error' : 'warning',
      message:
        `${hook.kind ?? 'choice_callback'} obligation "${hook.id}" (${hook.summary}) is unpaid: ` +
        `due by episode ${dueBy}, currently at episode ${episodeNumber}.`,
      sourceEpisode: hook.sourceEpisode,
      dueByEpisode: dueBy,
    });
  }

  return {
    episodeNumber,
    totalObligations: hooks.length,
    open,
    paid,
    abandoned,
    findings,
  };
}
