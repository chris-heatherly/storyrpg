/**
 * Feature flags for the Story-Aware Consequence Intelligence rollout
 * (`docs/CONSEQUENCE_INTELLIGENCE_PLAN_2026-06-05.md`, Part 10).
 *
 * Every new behavior in that plan is gated behind one of these env flags and is
 * DEFAULT-OFF: with the var unset (or any value other than `'1'`) behavior is
 * byte-identical to the pre-plan allocator. A flag activates its code path only
 * when its env var === `'1'`.
 *
 * This reader is intentionally PURE and UNCACHED — it re-reads `process.env` on
 * every call so tests can toggle a flag mid-run. Do not memoize the result.
 */

/** The set of consequence-intelligence feature flags, each true iff its env var === '1'. */
export interface ConsequenceFlags {
  /** Phase 1 — positional tiering (Layers A–C). `CONSEQUENCE_POSITIONAL`. */
  positional: boolean;
  /** Phase 2 — two-population budget + spine-derived heavy band. `CONSEQUENCE_TWO_POP`. */
  twoPop: boolean;
  /** Phase 3 — charge map (Rule 1 elevate / Rule 2 hollow-branch ban). `CONSEQUENCE_CHARGE`. */
  charge: boolean;
  /** Phase 4 — ConvergenceLedger artifact + single read path. `CONVERGENCE_LEDGER`. */
  ledger: boolean;
  /** Phase 5 — state-trajectory charge (relationship/identity/score). `CHARGE_STATS`. */
  chargeStats: boolean;
  /** Phase 5b — competence loop (skill/attribute roadblock→overcome). `CHARGE_COMPETENCE`. */
  competence: boolean;
  /** Phase 6 — episode-time charge materialization gate. `GATE_CHARGE_MATERIALIZATION`. */
  materializationGate: boolean;
}

/** True iff the env var is exactly the string `'1'`. */
function on(name: string): boolean {
  return process.env[name] === '1';
}

/**
 * Read the current consequence-intelligence flags from `process.env`. Pure and
 * uncached: call it where the decision is made so a flag flip is picked up
 * immediately (and so tests can mutate `process.env` between calls).
 */
export function consequenceFlags(): ConsequenceFlags {
  return {
    positional: on('CONSEQUENCE_POSITIONAL'),
    twoPop: on('CONSEQUENCE_TWO_POP'),
    charge: on('CONSEQUENCE_CHARGE'),
    ledger: on('CONVERGENCE_LEDGER'),
    chargeStats: on('CHARGE_STATS'),
    competence: on('CHARGE_COMPETENCE'),
    materializationGate: on('GATE_CHARGE_MATERIALIZATION'),
  };
}
