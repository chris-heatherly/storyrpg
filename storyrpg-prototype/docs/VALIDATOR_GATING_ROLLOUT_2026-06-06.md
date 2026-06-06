# Validator gating rollout — 2026-06-06

Systemic, content-agnostic re-tiering of the generation validators. **Nothing here
is ENDSONG-specific** — every change is a producer-side fix that applies to any
story. Rollout follows the project discipline: default-off → shadow data → flip.

## Single source of truth

`src/ai-agents/remediation/gateDefaults.ts` — `isGateEnabled(flag)` replaces the
scattered `process.env[f] === '1'` reads. Resolution order:

1. `process.env[flag] === '1'` → on (explicit override)
2. `process.env[flag] === '0'` → off (kill-switch override)
3. `GATE_DEFAULTS[flag]` → the rolled-out default
4. otherwise → off (un-rolled-out flags keep the old opt-in semantics)

Any flag absent from `GATE_DEFAULTS` behaves exactly as before (on iff env `'1'`).

## Current default state

| Gate flag | Default | Wave | Why |
|---|---|---|---|
| `GATE_NPC_DEPTH` | **ON** | 1 | deterministic in-place repair, tested |
| `GATE_CHOICE_IMPACT` | **ON** | 1 | derives metadata from structure |
| `GATE_STAT_CHECK_BALANCE` | **ON** | 1 | clamps difficulty band; never player-visible |
| `GATE_ARC_DELTA` | **ON** | 1 | mirrors arc endpoint |
| `GATE_MECHANICS_LEAKAGE` | **ON** | 1 | redacts isolated stat-delta tokens |
| `GATE_WITNESS_ID_INTEGRITY` | **ON** | 2 | safe after `witnessNpcResolver` root-cause fix |
| `GATE_JUDGE_STABILIZATION` | **ON** | 3 | hysteresis = less churn, never blocks |
| `GATE_CLIFFHANGER` | **ON** | 3 | hysteresis = less churn, never blocks |
| `GATE_DESIGN_NOTE_LEAK` | **ON** | 2 | shadow pass clean (0 leaks / 24 scenes); leaks are unshippable |
| `GATE_FINAL_CONTRACT_REPAIR` | **ON** | 4 | pure safety net — only runs on a failing contract, idempotent |
| `GATE_SETUP_PAYOFF` | OFF | 4 | repair module built; seam-wiring pending |
| `GATE_CALLBACK_COVERAGE` | OFF | 4 | needs LLM-regen handler + shadow data |
| `GATE_PROP_INTRODUCTION` | OFF | 4 | needs LLM-regen handler + shadow data |
| `GATE_CHOICE_DENSITY` | OFF | 4 | reroute to regen-choices pending |
| `GATE_CHOICE_DISTRIBUTION` | OFF | 4 | reroute to regen-choices pending |
| `GATE_CONSEQUENCE_BUDGET` | OFF | — | stays advisory (tier changes ripple downstream) |
| `GATE_ARC_PRESSURE` | OFF | — | stays advisory (repair = global replan) |

**Never gate** (kept advisory — LLM-judge / fuzzy-regex, false-positive prone):
TreatmentFidelity (architecture-stage), ThemePressure, MechanicalStorytelling,
SkillCoverage/Surface, PixarPrinciples, NarrativeFailureMode.

## Wave 0 — shadow instrumentation

`src/ai-agents/remediation/gateShadowLedger.ts` →
`generated-stories/gate-shadow-ledger.jsonl`. Every plan-time gate now runs in
**shadow mode even while its flag is off** (validators are pure/LLM-free) and logs
`{gate, validator, enabled, wouldGate, blockingCount, details}`. This is the data
that promotes a gate off→on. Disable with `STORYRPG_GATE_SHADOW=0`.

Read it to answer, per gate: *how often would this fire, how hard, and on what?* —
pair that with the shipped story to judge false-positive rate.

## Wave 4 — repair

- **Final-contract repair loop (keystone, built + wired, OFF).**
  `remediation/finalContractRepair.ts`. Previously `enforceFinalStoryContract`
  threw on first failure with no repair — the documented hard-abort landmine.
  Now, when `GATE_FINAL_CONTRACT_REPAIR` is on, a failing contract attempts bounded
  repair + re-validation before aborting. Deterministic handlers today (structural
  autofix, witness canonicalization); **LLM-regen handlers (template prose,
  design-note leaks, treatment drift) plug into the same loop next** — that is what
  makes the Wave-2 hard-gates safe to enable.
- **PropIntroduction repair loop (built + WIRED + tested, OFF).**
  `remediation/repairs/propIntroductionRepair.ts`
  (`repairAndRevalidatePropIntroduction`) resolves raw label→canonical-id references
  — the exact witness-bug class — against the cast roster via the shared 3-tier
  resolver, then re-validates through `runGatedRemediation` before the gate aborts.
  Genuinely-unknown references are NEVER rewritten, so a real dangling reference
  still blocks (no validator-gaming). Wired at the `GATE_PROP_INTRODUCTION` seam.
- **SetupPayoff repair (module built + tested, not seam-wired).**
  `remediation/repairs/setupPayoffRepair.ts` defers a dangling thread's
  `expectedPaidOffByEpisode` to the finale when it still has runway (the validator's
  own sanctioned fix; never fabricates a payoff). Seam-wiring deferred: the current
  diagnostics path derives threads from scene content without
  `expectedPaidOffByEpisode`, so the gate is effectively inert until an authored
  ThreadPlanner ledger is threaded in — wire then.
- **Callback / ChoiceDensity / ChoiceDistribution — NOT built (LLM-content).**
  Their gate-clearing repair is genuine content generation (author a payoff beat,
  insert a choice point, re-author a skewed choice set). The only *deterministic*
  way to clear them would be to mark phantom payoffs / fabricate choices — that games
  the validator and violates the fiction-first/quality contract, so it was NOT done.
  These need real LLM-regen handlers (SceneWriter / ChoiceAuthor) dropped into the
  same `runGatedRemediation` loop, tuned against live shadow data. Until then their
  gates remain OFF (so the missing repair never bites).

## Shadow run findings — 2026-06-06 (`bite-me-regen_20-49-00`, 4 episodes / 24 scenes, contract passed)

Final-contract-class shadow data (a *regen*, so the plan-time seam did not run — those gates have no data yet; a full from-scratch generation is needed for them):

| Gate | wouldGate | count | action |
|---|---|---|---|
| `GATE_DESIGN_NOTE_LEAK` | no | 0 | **flipped ON** (clean) |
| `GATE_AUTHORED_EPISODE_CONFORMANCE` | no | 0 | clean (kept off — needs more runs + fidelity repair) |
| `GATE_ENCOUNTER_ANCHOR_CONTENT` | no | 0 | clean (kept off) |
| `GATE_SIGNATURE_DEVICE_PRESENCE` | no | 0 | clean (kept off) |
| `GATE_SEVEN_POINT_ANCHOR_CONFORMANCE` | no | 0 | clean (kept off) |
| `GATE_INFORMATION_LEDGER_SCHEDULE` | **YES** | **11** | **keep OFF** — would hard-abort a story that shipped fine → over-strict for blocking; revisit validator severity, not the gate |

Decisions: design-note ON; final-contract repair loop ON (safety net); InformationLedgerSchedule stays advisory (over-strict); the other 4 fidelity gates stay off until (a) more runs confirm clean and (b) a fidelity-class repair exists so escalation self-heals instead of aborting. Plan-time gates / prop / micro-episode await a full-generation shadow run.

### Plan-time shadow — resume-proof fix + findings

The plan-time gates + their shadow lived only in the per-episode generation loop,
which is **skipped on resumed jobs** (episodes load from a checkpoint) — so resumed
runs produced no plan-time data and the gates were effectively inert for them. Fixed
by `remediation/planTimeShadow.ts` (`computePlanTimeShadow`): recompute all five
plan-time gates from the **assembled story at the final stage**, which runs on every
job. Wired into `recordFinalContractShadow`. The prop check applies the
label→canonical-id resolver on copies first, so the count reflects what a fresh-run
gate actually sees (not inflated label/id noise).

Backfilled from the 2026-06-06 run:

| Gate | wouldGate | count | note |
|---|---|---|---|
| `GATE_CHOICE_DENSITY` | no | 0 | clean |
| `GATE_CONSEQUENCE_BUDGET` | no | 0 | clean |
| `GATE_CALLBACK_COVERAGE` | no | 0 | clean |
| `GATE_SETUP_PAYOFF` | no | 0 | clean (inert without an authored ThreadPlanner ledger) |
| `GATE_PROP_INTRODUCTION` | yes | 7 (was 34 pre-resolver) | resolver clears 27/34; 7 genuine unresolved refs in a shipped story → keep OFF, investigate |

All five stay OFF: density/budget/callback/setup are clean on one run (need 1–2 more
to confirm before flipping); prop has 7 genuine unresolved references worth a look.

## Wave 0 shadow coverage (now complete across all gate classes)

Shadow logging records would-gate data **regardless of flag** for every gate class:
- Plan-time gates (setup-payoff, callback, density, budget, prop) — at the episode seam.
- Final-contract classes — `recordFinalContractShadow()`: design-note leaks (counted via
  a second ungated MechanicsLeakage scan) + all five treatment-fidelity validators
  (`runFidelityValidatorsShadow`, run ungated) + micro-episode-season.

So a live run now produces a full off→on promotion dataset for **every** held gate.

## Remaining work (LLM handlers — needs the live shadow run)

1. **Run the live shadow pass** (corpus + a fresh generation) to populate
   `gate-shadow-ledger.jsonl`. This is the go/no-go data for every OFF gate. It
   needs the worker + provider keys + time, so it runs in the generation env.
2. **Promote, gated on the data:** flip `GATE_DESIGN_NOTE_LEAK` and
   `GATE_FINAL_CONTRACT_REPAIR` once their shadow profiles are clean.
3. **Build the LLM-regen handlers** for Callback / Prop (insert payoff/intro beat)
   and **reroute** ChoiceDensity / ChoiceDistribution into the existing
   `runGatedRemediation` regen-choices driver. Then enable behind data.
4. **Wave-2 hard-gates** (micro-episode unconditional-hard, treatment-fidelity
   treatmentSourced-only) — enable ONLY after the final-contract repair loop is on,
   so an escalation attempts repair instead of hard-aborting.

## Reversibility

Every flip is one env var away from reverting (`GATE_X=0`), and every default lives
in one file. No story content was changed; all repairs are producer-side and gated.
