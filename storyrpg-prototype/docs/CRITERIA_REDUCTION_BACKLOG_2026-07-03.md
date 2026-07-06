# Criteria-Reduction Backlog (2026-07-03)

Living backlog for the "reduce fighting criteria / collapse redundant concept
systems" work. Until now the item numbers lived only in commit messages and
inline comments (e.g. `gateDefaults.ts` "criteria-reduction backlog item 7").
This file is the canonical list. Update it when an item lands or the evidence
shifts.

## Why (evidence)

Source analysis: 2026-07-02 pipeline-criteria audit. Re-verified against the
codebase and the run ledgers on 2026-07-03.

Quality ledger, split at the analysis date:

| Window | Runs | Blocked | Success | Avg success score | Max repair rounds |
|---|---|---|---|---|---|
| before 2026-07-02 | 480 | 303 | 111 | 65.3 | 20 |
| since 2026-07-02 | 33 | 28 | 5 | 94.0 | 6 |

Conclusion: where the refactor landed it worked — shipped runs are much better
and repair rounds dropped. The blocked-run bottleneck did **not** disappear; it
**moved**. The two dominant blocked `failureKind`s are unchanged
(`incremental_contract_ep_1` ~50%, `episode_architecture` ~32%), but their
contents changed.

Blocking sub-findings, recent runs (since 2026-07-02, from
`generated-stories/<run>/99-pipeline-errors.json`):

| Count | Sub-finding | Validator |
|---|---|---|
| 15 | `outcome_text_stub` | OutcomeTextQualityValidator |
| 6 | SceneConstructionGate abort ("Story Architect failed") | SceneConstructionGate |
| 5 | `treatment_event_ledger_violation` | TreatmentEventLedgerValidator |
| 3 | `qa_blocker_present` | QARunner |
| ~6 | assorted `treatment_fidelity_violation` | ArcLedger / RequiredBeat / SignatureDevice / SpatialUnit |

Repair-handler health (all-time, `generated-stories/remediation-ledger.jsonl`):

| Handler | runs | ok | degraded | note |
|---|---|---|---|---|
| final_contract_scene_prose | 401 | 354 | 47 | highest volume; prompt-dilution symptom |
| encounter_regeneration | 30 | 17 | 13 | **weak** (57%) |
| final_contract_outcome_text | 39 | 38 | 1 | works when it runs |
| cliffhanger_stabilized | 399 | 383 | 0 | healthy |
| final_contract_structural | 279 | 279 | 0 | healthy |

Through-line for this phase: **every blocking gate needs a working
deterministic repair, and SceneWriter needs one prompt channel.** The
contradictory-pair thesis from the original analysis is now only half the
story — recent blocks are plan-time construction conflicts and repair-handler
weakness, not contradictory gate pairs.

## Status legend

DONE · PARTIAL · TODO · DEFERRED

## Backlog

### 1. Resolve contradictory validator pairs — PARTIAL
- **1a. SceneSpatialUnit vs TreatmentEventLedger** — DONE. Movement-event
  exemption + plan-sanctioned multi-location in `SceneSpatialUnitValidator.ts`;
  explicit precedence in `reconcileConflictingFindings.ts` (EventLedger wins).
- **1b. Relationship pacing vs arc ledger** — DONE. `RelationshipPacingValidator`
  deleted (`ade84db7`); merged into `RelationshipArcLedgerValidator`;
  `relationshipPacingStagePolicy.ts` is now a plan-time policy util only.
- **1c. MechanicsLeakage vs NarrativeMechanicPressure** — PARTIAL. Relationship
  arm cut (`548041bf`) + `FICTION_SAFE_RESIDUE_GUIDANCE`. No hard cross-exemption
  for score/flag/item domains. **Next:** add a `reconcileConflictingFindings`
  rule mirroring the spatial/event precedence pattern.

### 2. Merge setup→payoff systems into one ledger — MOSTLY DONE
- Unified store is `CallbackLedger` (`pipeline/callbackLedger.ts`) with 8 kinds
  (`choice_callback`, `flag_promise`, `score_promise`, `tone`, `forward_promise`,
  `residue`, `thread`, `seed`). `ObligationLedgerValidator` owns gating.
  SetupPayoff + CallbackCoverage diagnostics retired from the live path
  (`aac079b1`); deterministic debt repair added (`195dd24c`).
- Still **separate** (DEFERRED — not appearing in recent failure data): twist
  foreshadow→reveal (`TwistPlan` / `TwistQualityValidator`), `setupPayoffEdges`
  (scene-plan graph), the convergence ledger.
- **Hygiene (item 5):** `isExcludedResidueFlag` duplicates the registry; the
  `ObligationLedgerValidator` header still says "SHADOW ROLLOUT" though the
  final-contract flip is live.

### 3. Cap + funnel scene obligations into SceneConstructionProfile — CORE DONE
- **Re-verified 2026-07-03: the content funnel + hard cap are implemented.**
  `buildSceneConstructionPromptView` (`sceneConstructionProfile.ts:1106`) PRUNES
  `requiredBeats`, `keyBeats`, `choicePoint`, and every contract array
  (relationshipPacing, mechanicPressure, stakesArchitecture, arcPressure,
  worldTreatment, characterTreatment, seasonPromise, storyCircleBeat,
  failureModeAudit, …) down to the profile-active ids via `keepByProfile`.
  `applySceneConstructionProfileToScene` (`:1162`) already mutates the scene to
  this pruned view at StoryArchitect time, and `SceneWriter.buildPrompt` re-applies
  it (`:1704`) as a defensive idempotent net. Obligations demoted to
  texture/routed/metadata are DROPPED from the subsections, not just capped in
  the profile block. Compile caps (`maxHardUnits` 4–5, `maxTotalUnits` 6–7.5,
  `must_support` ≤5–6 with excess → texture) bound the active set, so the ~14
  prompt subsections render only the funneled/bounded obligations — they are
  type-specific RENDERINGS of one funneled set, not independent channels.
- **What actually remains (prose-quality-sensitive — needs a live A/B run + judge,
  out of scope for a code-only session):**
  1. The active obligations are listed twice — once tersely in the profile block
     (#4 "Active obligations serving this turn") and again with type-specific
     guidance in the per-type subsections (#7). De-duplicating (profile block
     carries the frame + texture/routed; subsections carry the detail) would trim
     tokens without losing guidance — but must be A/B'd against prose quality.
  2. The ~52-bullet static "Scene Craft Targets" block (`SceneWriter.ts:1760-1811`)
     is the larger token sink; trimming it is a prose gamble that must be measured
     on shipped-run scores, not assumed.
- Likely relationship to repair weakness (`final_contract_scene_prose` 47 degraded,
  `encounter_regeneration` 13/30): repair rewrites inherit the same large prompt,
  so (1)/(2) are still the best candidate levers — but only with live measurement.

### 4. Demote plan-conformance gates to telemetry — DONE
- `GATE_CHOICE_TYPE/CONSEQUENCE_TIER/SKILL_PLAN_CONFORMANCE` deleted from the
  registry (`5486f73d`); the final contract emits conformance findings as
  warnings unconditionally. Re-promotion requires a per-episode rebalance autofix.

### 5. Recalibrate (don't remove) keeper heuristics — PARTIAL
- `FidelityRealizationJudge` overlay (`GATE_FIDELITY_JUDGE_CONFIRM`) can downgrade
  heuristic false positives, but keyword-overlap heuristics still fire first and
  the beat-realization trio (`REQUIRED_BEAT_REALIZATION`,
  `SIGNATURE_DEVICE_PRESENCE`, `ENCOUNTER_ANCHOR_CONTENT`, + `SIGNATURE_PRESENCE_STRICT`)
  remain 4 separate blocking gates.
- **4c (judge as arbiter) — evaluated, NO CHANGE.** The judge overlay already
  arbitrates: heuristics fire cheaply, the judge downgrades refuted findings to
  warnings, and on judge failure everything stays blocking (fail-safe). Making
  the heuristics purely advisory with the judge as *sole* blocker would REGRESS
  that fail-safe (judge unavailable → nothing blocks). The goal ("model, not
  keyword overlap, decides what blocks") is met by `GATE_FIDELITY_JUDGE_CONFIRM`
  without the risk. Consolidating the 4 gates into 1 is cosmetic (same overlay).
- `OutcomeTextQualityValidator`: **investigated, echo tolerance left as-is.**
  The original analysis flagged the `+24` echo threshold as churn. Current
  evidence contradicts this: the #1 recent outcome-text blocker is
  `outcome_text_stub` (15) — an *unauthored fallback tier*, whose repair
  (`final_contract_outcome_text`) succeeds 38/39 once it runs (the `595c8e89`
  routing fix made it run). The echo finding ("restates the stakes annotation")
  is essentially absent from recent runs, so retuning `isEcho` would relax a
  correctness gate that isn't firing. (Note for future: in this code `isEcho`
  flags when the tier adds ≤ tolerance chars, so *raising* the threshold flags
  MORE, not fewer — the intuitive "widen to relax" is inverted here.)
- Beat-realization trio: consider making `FidelityRealizationJudge` the sole
  blocker (the overlay already exists). See item 4c below.

### 6. Instrument the decision — PARTIAL
- `gate-shadow-ledger.jsonl` records would-gate data for disabled gates.
  Shadow gates that always fire (calibration bugs, not quality signals) since
  2026-07-02: `GATE_TREATMENT_FIELD_UTILIZATION` 27/27, `GATE_CHOICE_DISTRIBUTION`
  20/22, `GATE_PROP_INTRODUCTION` 35/54. Do not re-promote as-is.
- This doc is the sub-finding audit deliverable.

### 7. (code-referenced) Plan-conformance kill-switches removed
- Same as item 4; the "item 7" label in `gateDefaults.ts` / `gateRegistry.test.ts`
  refers to the deletion of the dead conformance kill-switches. Kept here so the
  numbering has a home.

## Route-cue construction conflict (post-refactor regression) — DONE
The funnel work introduced a new plan-time blocker: `SceneConstructionGate`
route-event-ownership order aborts (6 recent). The deterministic scene-plan
builder had a repair rung (`4357093a`), but the LLM-authored path
(`authorScenePlan.ts`) bypassed it. A fix was landed then reverted 57s later
(`c92a40d1` → `ff3ab8ba`); re-verified safe against current goldens and re-landed
2026-07-03. `PlannedScene[]` is a linear order-based plan (safe to swap); the
blueprint inherits the repaired order via `buildBlueprintFromPlannedScenes`.

## Priority order (next actions)
Landed 2026-07-03 (this pass):
- ~~Re-land route-cue repair on the LLM-authored path~~ — DONE.
- ~~Item 1c: reconcile MechanicsLeakage vs NarrativeMechanicPressure~~ — DONE
  (leak wins; scene-id attribution added so it's repair-targetable).
- ~~Item 5 hygiene: `isExcludedResidueFlag` registry dedup + stale "SHADOW
  ROLLOUT" header~~ — DONE.
- Item 4b (echo tolerance) — evaluated, NO CHANGE (echo is not the churn source;
  the `+24` direction is inverted from intuition).
- Item 4c (judge as sole blocker) — evaluated, NO CHANGE (existing overlay is
  already the arbiter and is fail-safe).
- Item 3 — re-verified CORE DONE (content funnel + hard cap).

Remaining (need a live generation run + judge to validate — out of scope for a
code-only session):
1. Item 3 leftovers: de-dup the active-obligation listing (#4 vs #7) and trim the
   static craft block; measure on shipped-run scores.
2. `outcome_text_stub` (#1 recent blocker): confirm the `595c8e89` routing fix
   holds under load; the repair succeeds 38/39 when it runs.
3. Item 2 leftovers (twist / setupPayoffEdges / convergence into the unified
   ledger) — DEFERRED until they appear in failure data.
