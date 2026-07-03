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
 * SHADOW ROLLOUT (P2.5): this runs as a per-episode diagnostic — findings are
 * saved to episode-N-obligation-ledger.json and logged, while the legacy
 * validators stay authoritative for gating. The flip (routing these findings
 * into the final contract in place of the legacy validators') is live-run
 * gated, per repo policy.
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
    findings.push({
      gateId: gateFor(hook.kind),
      kind: hook.kind ?? 'choice_callback',
      hookId: hook.id,
      severity: windowClosedInSlice && dueBy <= episodeNumber ? 'error' : 'warning',
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
