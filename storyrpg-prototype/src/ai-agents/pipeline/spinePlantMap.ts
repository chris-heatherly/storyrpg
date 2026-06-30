/**
 * Spine plant→payoff map (Season Canon, Phase 5).
 *
 * The season spine (SeasonPlannerAgent, up front) is the SOURCE of the explicit
 * `payoffEpisode` targets: for each thread/promise it declares which episode plants
 * it and which episode pays it off. This module is the deterministic consumer —
 * it applies that map onto the PromiseLedger so the promise-due gate has a concrete
 * target to enforce. The map's CONTENT is LLM-proposed (in the spine); pinning it
 * onto ledger state is deterministic.
 *
 * Entries reference a promise either by its ledger hook id directly, or by the
 * flag it gates (resolved to the `flag:<flag>` hook id the ledger mints in
 * recordFlagSet). Pure — unit-testable, no I/O.
 */

import type { CallbackLedger } from './callbackLedger';

export interface SpinePlantEntry {
  /** Ledger hook id, if known. Takes precedence over `flag`. */
  hookId?: string;
  /** The flag this promise gates; resolved to hook id `flag:<flag>`. */
  flag?: string;
  /** REQUIRED explicit target episode (not a vague window). */
  payoffEpisode: number;
  /** Optional slack — latest acceptable payoff episode. Defaults to payoffEpisode. */
  payoffEpisodeLatest?: number;
}

export interface SpinePlantMap {
  entries: SpinePlantEntry[];
}

export interface ApplySpineResult {
  applied: number;
  /** Entries whose target hook wasn't found in the ledger (planted later, or typo). */
  unmatched: SpinePlantEntry[];
}

function hookIdFor(entry: SpinePlantEntry): string | undefined {
  if (entry.hookId) return entry.hookId;
  if (entry.flag) return `flag:${entry.flag}`;
  return undefined;
}

/** Minimal shape of the season plan's carry-flags (avoids a SeasonPlan import). */
interface SeasonFlagSource {
  seasonFlags?: Array<{ flag: string; setInEpisode?: number; checkedInEpisodes?: number[] }>;
}

/**
 * Derive the SpinePlantMap from the season plan's existing `seasonFlags` — no LLM
 * schema change needed. Each carry-flag already declares where it's set
 * (`setInEpisode`) and where it's checked (`checkedInEpisodes`); the first forward
 * check becomes the explicit `payoffEpisode`, the last the optional latest slack.
 * Flags with no forward check are skipped (no enforceable payoff target).
 */
export function deriveSpinePlantMap(plan: SeasonFlagSource | undefined): SpinePlantMap {
  const entries: SpinePlantEntry[] = [];
  for (const sf of plan?.seasonFlags ?? []) {
    if (!sf?.flag || sf.setInEpisode == null) continue;
    const forwardChecks = (sf.checkedInEpisodes ?? []).filter((e) => e > sf.setInEpisode!).sort((a, b) => a - b);
    if (forwardChecks.length === 0) continue;
    entries.push({
      flag: sf.flag,
      payoffEpisode: forwardChecks[0],
      payoffEpisodeLatest: forwardChecks[forwardChecks.length - 1],
    });
  }
  return { entries };
}

/**
 * Pin each spine entry's explicit payoffEpisode onto its ledger hook. Returns how
 * many applied and which entries had no matching hook yet (so the caller can retry
 * after the planting episode generates, or log a spine/ledger mismatch).
 */
export function applySpinePlantMap(ledger: CallbackLedger, map: SpinePlantMap | undefined): ApplySpineResult {
  const unmatched: SpinePlantEntry[] = [];
  let applied = 0;
  for (const entry of map?.entries ?? []) {
    const id = hookIdFor(entry);
    if (!id || !ledger.has(id)) {
      unmatched.push(entry);
      continue;
    }
    ledger.setPayoffEpisode(id, entry.payoffEpisode, entry.payoffEpisodeLatest);
    applied += 1;
  }
  return { applied, unmatched };
}
