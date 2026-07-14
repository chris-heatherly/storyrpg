# Architectural Review — Repair Convergence (2026-07-14, evening)

Follow-up to `RELIABILITY_AUDIT_2026-07-13.md` and `RELIABILITY_REMEDIATION_PLAN_2026-07-14.md`
(Waves A–D landed). Grounded in the worker-1784056785472 failure (run dir
`bite-me_2026-07-14T17-29-14`, failed 19:27:59Z at s1-3) and HEAD as of 4afeb4e1.

## I. Regime shift

The July 13 problem was an abort machine: findings had no repair routes, gates
fired on measurement bugs, nothing was salvaged. That is largely fixed — scenes
1–2 now pass, repairs are transactional and role-aware, findings are accurately
classified. The remaining problem is different in kind: **the repair loop is a
search procedure that cannot converge under its own control policy.** Every
piece is present; the policy wiring between the pieces throws progress away.

## II. Anatomy of the current blocker (s1-3, from repairHistory)

Target: `task:event:ep1-u3:owner-event`, missing `semantic:2`, `semantic:3`.
Sibling finding: Stela named-introduction (presence task).

| Call | Outcome | What actually happened |
|---|---|---|
| 1 | `invalid_patch` | Model authored ≥3 ops; validator cap was 2 ("must contain one or two operations") |
| 2 | `candidate_rejected` | Valid patch **resolved the presence finding, introduced nothing** — net progress — rejected because the *target* fingerprint didn't clear; candidate discarded, baseline reset |
| 3 | `invalid_patch` | ≥3 ops again (model keeps saying the edit needs more room) |
| 4 | `call_failed` | "Duplicate semantic patch request suppressed" — identical requestHash to call 2, because the baseline never advanced |
| — | full regen | No preserve-guidance on this tier; still missing semantic:2/3 |
| — | **abort** | Event tasks are always "critical" (`isCriticalOwnerRealizationFinding`: `canonicalEventId → true`) so the defer tier can never apply; 2 passed scenes discarded |

Aggravators: the capacity fix (4afeb4e1, 19:31Z) landed **4 minutes after this
run failed** — it has never been exercised, and nothing stamps the worker's git
SHA so this was only discoverable by comparing commit timestamps. Resume
ancestry is stale (job friendlyName: "Resume … from s1-1→s1-2 bridge"), so every
attempt regenerates scenes 1–2, re-exposing *passed* scenes to provider
variance. Best-of-two SceneWriter applies during repair iterations.

Six interlocking policy defects, none of them a validation bug:

1. **Greedy target-only acceptance** (`shouldAdoptOwnerRepairCandidate`,
   realizationTaskGate.ts:107-117): rejects any candidate still carrying the
   target fingerprint, even one that strictly reduced total misses.
2. **No memory**: rejected candidates are discarded; the next call restarts from
   the original scene and must re-win the same fixes inside the same budget.
3. **Duplicate suppression + no memory = wasted budget**: identical baseline +
   identical target ⇒ identical request ⇒ suppressed.
4. **Capacity decoupled from work**: 2-op cap vs 2 semantic misses + collateral;
   the new tier scaling (3/4 ops) is unproven and its escalation trigger is a
   message regex (`/operations/i`), not a structured reason.
5. **Preservation absent on the last tier**: `preserveAtoms` guidance feeds
   patches (ContentGenerationPhase.ts:2509,2557) but not the escalation regen —
   the most destructive move has the least protection.
6. **Terminal policy excludes the failing class**: the defer machinery
   (`deferredRealization.ts`) exists and works, but `isCriticalOwnerRealizationFinding`
   marks every event/premise-sourced task critical, so the exact class that
   fails (owner-event) can never defer → abort.

## III. The convergence argument (why this can't work as wired)

With 2 authored attempts, target-only acceptance, and baseline reset, success
requires **one single call to clear every missing atom at once** while
disturbing nothing — partial wins are discarded, and a repeat of a rejected
attempt is suppressed as a duplicate. The probability of one call clearing K
interacting atoms falls fast in K, and judge re-rolls add noise on top. A
best-candidate loop changes the math: each call only needs to make *some*
progress, progress accumulates, and the same budget converges in ~K calls.
Same models, same judges, same standards — different acceptance rule.

## IV. What is needed (in order)

### A. Make the repair loop a best-candidate hill-climb (the core fix)

- **Accept net progress**: adopt any candidate with strictly fewer total
  blocking misses and no new-task failures, even if the target fingerprint
  persists. Target-clearing is the goal, not the acceptance test.
  (realizationTaskGate.ts:107-117 + adoption call sites in ContentGenerationPhase.)
- **Advance the baseline**: the adopted (or best-so-far) candidate becomes the
  base for the next patch call. Never issue a byte-identical request — if the
  hash matches a prior one, something must change (baseline, target set, tier).
- **Union targeting**: pass *all* remaining blocking findings as the patch
  objective (target task first) so sibling fixes are deliberate, not accidental
  and discarded.
- **Capacity ∝ work**: ops budget ≥ missing atoms + 1 (cap 4–5); escalate tier
  on the structured `invalid_patch` op-count reason, not message sniffing.
  Prove the landed tier scaling offline before the next live run.
- **Preserve guidance on every tier**: pass `preserveAtoms` (+ satisfied-passage
  excerpts) into the escalation regen prompt.
- **Cheaper, quieter verification**: re-judge only claims whose supporting beats
  changed (verdict cache keyed by beat hash); fewer re-rolls = less noise +
  lower cost per iteration.

### B. The frontier never moves backwards

- Redefine *critical* as reader-safety/structural only (unreachable graph,
  placeholder/stub prose, POV corruption). An owner-event miss that survives
  patches + regen becomes a `DeferredRealizationRecord` (`owner_repair_exhausted`)
  and the episode continues; the authoritative final semantic repair loop gets
  it with full-episode context and remaining budget.
- If the final loop still can't clear it, the run fails **at packaging** with
  everything salvaged (partial story, scene locks, deferred ledger) — not at
  scene 3 with nothing.
- Passed scenes are immutable within a run: committed scene locks are not
  re-generated or re-judged by later repair activity.

### C. Fix iteration economics (why debugging feels endless)

- **Offline single-scene repair harness** (highest-leverage tooling item): a CLI
  that loads `episode-N-scene-X-realization-blockers.json` (it already contains
  candidate scene + findings + tasks + repairHistory — everything needed) and
  runs the patch/adjudication/regen loop live against providers for that one
  scene. Turns the 60–90-minute discovery loop into ~2 minutes; every policy
  change in section A gets proven here first. Precedent: `replay:gates` CLI.
- **Resume from the deepest ancestor**: resume must target the latest failed
  job's checkpoint (not the first ancestor) and rehydrate passed scene locks so
  scenes 1–2 are never regenerated. Replaying passed scenes is not just slow —
  it re-exposes them to judge/provider variance and can newly fail them.
- **Stamp the worker git SHA** into the run dir + ledger row (today's
  capacity-fix confusion was only resolvable by comparing commit timestamps).
- **Disable best-of-two SceneWriter during repair iterations** (first drafts only).

### D. Retire latent surface debt as a matrix, not serially

Each newly reachable surface has been the next boss: s1-3 exposed adoption
policy, s1-4 exposes `deterministic choice fallback cannot satisfy its assigned
choice contract` (ContentGenerationPhase.ts:3380). Scenes 5–9 (including the
encounter scene — a whole distinct owner stage) have never been reached and
will contain the same class of untested repair-path debt.

- Fix the known s1-4 blocker now: a contract-bearing choice must route to a
  ChoiceAuthor re-author with contract feedback — a deterministic fallback for
  it is a fiction-first violation anyway.
- Build the coverage matrix: owner surfaces (scene_writer, choice_author,
  shared resolution, encounter_architect, transitions) × finding codes; every
  cell needs a handler + an offline fixture test (extend
  repairRouteCoverage.test.ts with mined fixtures). Audit the encounter stage
  offline this week instead of discovering it live next week.

### E. What does NOT change (quality preservation)

Judge verdicts, semantic criteria, the final contract, and the QualityScore v4
ship band are untouched. Defer ≠ ship: every deferred finding is re-validated at
the final contract, and unresolved confirmed misses still block packaging. The
only behavioral change is which side wins a tie that today is resolved as
"discard everything": keep the best imperfect candidate and let a
better-equipped later pass finish the job.

## IV-b. Surface sweep results (2026-07-14, evening — executed)

The s1-4 failure (job worker-1784057692085, 12:34–12:46 PDT) ran code
predating all five review fixes; it exercised only the 12:31 capacity commit
(which cleared s1-3 for the first time) and died at the shared-resolution
abort — the sibling of the fallback site section IV-D fixed. Every remaining
owner-stage terminal site was then audited:

| Site (ContentGenerationPhase) | Class | Action |
|---|---|---|
| Shared-resolution-only blockers (was :3374) | missing meaning on a valid choice set; own metadata names repair_choice | **CONVERTED** — commits the set, defers non-critical residue (584885f1) |
| ChoiceCommitBlocker (was :3486) | same class at commit time | **CONVERTED** — critical/structural still throws; meaning misses defer + write `choice-realization-blockers` diagnostic (replay-harness compatible) |
| OwnerStageValidatorSnapshotMismatch :2688 | replay determinism invariant | KEEP — inconclusive/unavailable consensus is now cached by full claim identity (d498869f), so replay is deterministic for identical candidates |
| Encounter preflights :4428–4457 | second-line invariants | KEEP — plan-time mirrors already exist in StoryArchitect (:3367–3400: binding, stakes, skills, beat plan ≥3); scene-time reachable only via blueprint mutation |
| Encounter template collapse :5206 | reader-safety (deterministic filler) | KEEP default; sanctioned lever exists: `GATE_ENCOUNTER_TEMPLATE_ABORT=0` defers to the final contract's template-collapse repair |
| ProducerPhaseBlocker :5272 | structural (malformed producer output) | KEEP — writes `producer-blockers.json`; resume is unit-scoped |
| Encounter quarantine :5320 / missing content :5369 | structural | KEEP — escalated retry pass + unit-scoped resume already built in |

Net: after 584885f1, no owner-stage site aborts a run over non-critical
missing meaning. Remaining aborts are structural, forbidden-content, or
determinism invariants — the taxonomy section IV-B prescribes.

## V. Sequencing

1. Build the offline harness (C) against the s1-3 blockers fixture from
   `bite-me_2026-07-14T17-29-14`.
2. Land A (acceptance, baseline advance, union targeting, regen preservation,
   structured tier escalation) and prove convergence offline on that fixture:
   the recorded history shows exactly the candidate that should have been kept.
3. Land B (criticality redefinition + defer for event tasks) and the s1-4
   choice-contract route (D), with offline fixtures.
4. Fix resume ancestry + scene-lock rehydration + SHA stamping (C).
5. One watched live run. Expected shape: scenes converge in ≤K+1 patch calls,
   any stubborn task arrives at the final contract as a deferred record, and
   the run reaches packaging — possibly failing there, but with everything
   salvaged and attributed.
