# Systemic Guards Plan — 2026-07-15

Successor to `RELIABILITY_AUDIT_2026-07-13.md` / `ARCHITECTURE_REVIEW_CONVERGENCE_2026-07-14.md`.
Purpose: stop the five recurring failure patterns *mechanically* — so new
instances fail in CI or degrade to score caps instead of killing runs — and
close the three self-inflicted gaps from the remediation sprint.

The five patterns (each hit 3–6 times in July):
P1 string-equality between two LLM outputs · P2 router/handler/validator name
drift · P3 fail-closed on non-content conditions · P4 duplicated fact-collectors
drifting · P5 cross-stage verdict disagreement on unchanged content.

Standing principles carried forward: LLMs write, deterministic systems enforce;
confirmed content misses stay blocking; deferral ≠ shipping; every wave owes a
live-run check; explicit-path commits, one workstream per commit.

---

## Wave 1 — Close the self-inflicted gaps (S, ~half day; safe while a run is live)

### 1.1 Per-spawn SHA + dirty marker (attribution integrity)
`proxy/tsNodeSpawn.js` caches the git SHA at proxy startup — the container has
stamped `fcedc501ae` on every run since last night regardless of what actually
ran.
- Resolve the SHA per spawn (subprocess cost is negligible per job).
- Host path: append `-dirty` when `git status --porcelain` is non-empty.
- Container path (no git binary): fs fallback can read HEAD but not dirtiness —
  stamp `+mount` so container-run rows are distinguishable.
- `buildInfo.ts`: env var wins; same dirty semantics for CLI runs.
- **Constraint:** tsNodeSpawn is proxy-side — recreate the compose container
  only AFTER the in-flight run finishes (a restart kills its worker).

### 1.2 Deferral backpressure telemetry
Deferral has no gauge; a future regression deferring 30 findings/run would only
surface as final-contract drowning.
- `QualityLedgerEntry.deferredRealizationCount` + populate in both
  `pipelineOutputWriter` paths from `deferredRealizationRecords.length`.
- Advisory warning event when a single episode defers > 12 findings.

### 1.3 Budget-debit producer-boundary re-authors
The encounter description sanitation pass calls the LLM outside the remediation
budget.
- Wrap in `shouldAttemptRemediation` + `remediationBudget.spend(1)` per
  re-authored field + `recordRemediationSafe` record
  (`rule: 'producer_description_sanitation'`).

**Verify:** unit tests; next fresh run's ledger row shows a truthful SHA and a
deferral count.

---

## Wave 2 — Pattern-killers, small (S each, ~1 day total)

### 2.1 CI repair-closure assertion (kills P2 permanently)
The rename-regression class (outcome-stub Jul 3, SemanticRealizationJudge
routing, prose-handler allowlist) has cost more runs than any other. Make it a
build failure instead of a live discovery:
- New `src/ai-agents/remediation/repairClassRegistry.ts`: one typed table —
  blocking issue class (validator + issueCode/type) → routing directive +
  executing handler rule name + terminal policy
  (`repair | defer | cap | abort(reason)`).
- Extend `repairRouteCoverage.test.ts` into a closure test:
  1. every `tier: 'blocking'` validator-registry entry and every realization
     finding code appears in the table;
  2. every table entry routes to a non-`diagnostic_stop` directive OR carries a
     documented `abort(reason)`;
  3. every named handler rule exists in the final-contract handler list;
  4. every default-ON blocking gate in `gateRegistry` (ALL placements — extends
     the season-final-only `validateGateRegistry` policy, Phase 2.2) declares
     `repair` or a terminal policy.
- Adding a blocking class without completing the row = red CI.

### 2.2 Shared entity-identity module (kills new P1 instances)
- New `src/ai-agents/utils/entityIdentity.ts`: `entityTokens()` (normalize:
  case, diacritics, possessives, articles/prepositions) +
  `entityTokensMatch(a, b)` (subset either direction) — extracted from
  `semanticContractIr.semanticLocationTokens` (re-exported for compat).
- Migrate now: semantic IR location authority (done, re-point), the
  `PLAN_DUPLICATE_SCENE_TURN` Jaccard fallback, and prop-introduction
  raw-label→roster matching. Others opportunistically.
- Write the rule where reviews will see it (`.claude/skills/
  pipeline-validation/SKILL.md` + `docs/STORY_QUALITY_CONTRACT.md` appendix):
  **cross-artifact identity is never `===`/`.has()` on free text — it is
  `entityTokensMatch`, or a judge. Content verdicts are never fuzzy.**

### 2.3 Reader-facing description enumerator (first cut of P4)
The producer sanitation pass and `encounterMetadataRepairHandler` hand-rolled
the same description-field walker on the same day — the drift pattern being
born in real time.
- New `src/ai-agents/utils/readerFacingDescriptionFields.ts`: enumerate
  `{ path, get, set }` for encounter `description` / `phases[i].description` /
  `storylets.<k>.description` (extensible to choices/scenes later).
- Consume from both existing sites; RouteContinuityValidator's
  `collectRouteTextFields` asserts parity in a test (same field set) without a
  risky rewrite.
- Standing rule: one collector per surface; delete the copy when you touch it.

---

## Wave 3 — Structural guards (M; 3.1 after the first packaged episode)

### 3.0 Kill-table aggregator (prerequisite instrument)
Port the ad-hoc mining into `scripts/report-kills.ts` (`npm run report:kills`):
per-gate/validator kill and FP counts from `99-pipeline-errors.json` +
ledger attribution. Promotions/demotions run on this, not anecdote.

### 3.1 Scored-band demotion (kills P3 for gates not yet written)
The only guard that protects against FUTURE fail-closed bugs.
- One table (`remediation/terminalPolicy.ts`): the hard-blocking core —
  structural integrity (graph reachability, producer schema,
  OwnerStageNotExecuted), reader safety (unsafe_fallback/template/placeholder
  prose, POV corruption, mechanics leaks), and confirmed semantic misses on
  canonical events. Target ≤15 classes.
- Everything else (fidelity family, craft, pacing, ledgers, coverage floors,
  Story Circle evidence) at the final contract: repair first (unchanged), and
  on exhaustion **ship with a QualityScore cap** (existing `capIds` /
  cap-aware ship band machinery) instead of `PipelineError`.
- Triage each demotion against the 3.0 kill table; each flip documented in the
  table with its evidence, per the promotion protocol.
- **Sequencing:** after the first package — triage should be informed by a real
  success, and the fresh run in flight may provide it.

### 3.2 Receipt continuity owner→final (kills P5, halves judge cost)
- Persist per-scene semantic receipts (already produced by
  `finalizeSceneRealizationHandoff`) keyed by `candidateHash` into run state.
- `validateStorySemanticRealization` at the final contract: for tasks whose
  owning scene hash is unchanged since an owner-stage PASS receipt, reuse the
  verdict instead of re-rolling the judge. Changed scenes re-judge fully.
- Explicitly NOT a new gate: a missing/mismatched receipt just means "judge it
  fresh" — no parity aborts.

---

## Wave 4 — Governance that makes it stick (S, docs + scripts)

- **Gate lifecycle checklist** (enforced by 2.1): a new blocking class ships
  with defaults+registry entries, router rule, executable handler, mined
  fixture test, and shadow evidence — or CI is red.
- **Ops runbook** (`docs/` + `pipeline-debugging` skill): the real proxy is the
  compose container (`docker compose -f docker-compose.proxy.yml up -d` to
  recreate; local `node proxy-server.js` is a split-brain trap); plan-time
  fixes need a FRESH run, resume chains carry fossil IR; commit-then-run
  cadence so SHA attribution stays meaningful.
- **Skill updates:** fold the P1 rule and the "one collector per surface" rule
  into `pipeline-validation` / `pipeline-agent-development` skills so every
  future session inherits them.

---

## Explicitly rejected (protection delivered cheaper elsewhere)

- Runtime transactional episode closure & parity-hash abort gates → add new
  ways to die; 2.1 + 3.2 deliver the protection.
- Full `ShippableRealizationView` refactor → incremental per-surface
  consolidation (2.3 pattern) when touched.
- Runtime `RepairExecutionRegistry` preflight → CI-time closure test (2.1).

## Verification & sequencing

| Wave | Effort | When | Gate |
|---|---|---|---|
| 1 | ~0.5d | now (live-run safe; container recreate deferred to run end) | unit + next run's ledger row truthful |
| 2 | ~1d | now | closure test red→green on a deliberately broken row; suites green |
| 3.0 | ~0.25d | with Wave 2 | kill table matches July hand-mined numbers |
| 3.1 | ~1.5d | after first package | live run: craft-class failures become caps, band=warn ships |
| 3.2 | ~1d | after 3.1 | judge call count per run drops ~half; zero owner-pass/final-fail flips on unchanged scenes |
| 4 | ~0.5d | alongside | docs/skills merged; audit:skills + sync:skills run |

Total: ~4.5 focused days, of which only 3.1/3.2 are deferred behind the first
packaged episode. Nothing here rolls back a landed patch; the sprint's fixes
stand — these waves make their direction self-enforcing.
