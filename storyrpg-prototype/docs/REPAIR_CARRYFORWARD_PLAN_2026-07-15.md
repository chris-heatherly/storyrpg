# Repair Carry-Forward Plan — 2026-07-15

> **SHIPPED 2026-07-15** behind `GATE_REPAIR_CARRYFORWARD` (default ON, infra,
> reversible via env=0). Implementation notes vs this plan:
> - Candidate persists to `checkpoints/final-repair-candidate-<phase>.json`
>   keyed by enforcement phase, so the incremental per-episode contracts get
>   carry-forward too, not just `final_story_contract`.
> - Module: `src/ai-agents/remediation/finalContractCarryForward.ts`; IO in
>   `pipelineOutputWriter.ts`; consumption in `FullStoryPipeline.
>   prepareRepairCarryForward()`; persistence + deterministic-re-failure
>   advisory at the finalContract.ts failure site (before the throw).
> - Hill-climb overwrite is BY DESCENT rather than by comparison: a base-hash
>   match always consumes, so the stored candidate is only ever replaced by
>   its own descendant, and the repair loop's requireMutationEvidence +
>   rejectIntroducedBlockingIssues make each descendant content-monotone.
> - Deferred-fingerprint pairing (Phase D) deliberately NOT implemented:
>   validation re-runs in full against the carried candidate, so a drifted
>   deferred set can only make the candidate less helpful, never wrong.
> - Proven offline against bite-me_2026-07-15T20-44-49's real artifacts
>   (persist → consume → advisory → stale-discard).

Problem: **repairs don't persist across resumes.** Every resume rehydrates the
episode from its frozen watermark checkpoints, re-runs the final contract, and
starts the repair loop from the PRE-repair content — the previous resume's
successful repairs are discarded when the contract still fails. The repaired
story is already persisted every round (`repair-snapshots/round-NN.json`) and
at failure (`partial-story.json`), but **nothing consumes those artifacts**:
they have zero readers outside tests. Each resume pushes the same rock up the
same hill with a fresh 3-round budget; any blocker set needing more cumulative
rounds than one enforcement run allows can never clear through resumes.

Evidence: bite-me_2026-07-15T20-44-49 took four resumes to peel three stacked
repair defects — and even with all of them fixed, each resume re-repaired
everything the previous one had already fixed.

Design rules (consistent with the standing policies):
- Carry-forward is BEST-EFFORT: a missing, stale, or mismatched candidate
  means "start from watermarks exactly as today" — never a new abort class.
- Nothing is trusted: the carried candidate is fully re-validated; it is only
  a better STARTING TEXT, never a skipped check.
- Hill-climb at the resume scale: a stored candidate is only replaced by a
  better one (fewer remaining blocking fingerprints, or equal count with a
  changed set = content progress), mirroring the owner-stage adoption rule.

---

## Phase A — Persist a canonical repaired-candidate checkpoint (~0.5d)

At the end of a still-failing final-contract repair loop, write a real
checkpoint artifact (not just run-dir diagnostics), via the existing
checkpoint store so resume plumbing already carries it:

`final-repair-candidate-ep<N>` containing:
- `schemaVersion`, `episodeNumber`, `createdAt`, `workerGitSha`
- `baseWatermarkHash` — stable hash of the PRE-repair assembled episode the
  candidate was derived from (the invalidation key)
- `candidateStory` — the one-episode story as of the last accepted repair round
- `remainingBlockingFingerprints` — sorted, for monotonicity + loop detection
- `resolvedFingerprints`, `appliedRounds`, `cumulativeIssueAttempts`
- `deferredFingerprints` — the deferred-realization set as of derivation

`repair-snapshots/` stays untouched (forensics).

## Phase B — Consume on resume (~1d, the delicate part)

In the episode-lock path (`validateEpisodeIncrementally` → final-contract
input assembly), after rehydrating the frozen episode:

1. Load `final-repair-candidate-ep<N>` if present.
2. Validity: `baseWatermarkHash` must equal the hash of the freshly
   rehydrated pre-repair episode (same canonicalized projection used as the
   contract input). Mismatch ⇒ upstream content changed (scene regenerated,
   plan fix, invalidated checkpoint) ⇒ discard with a log line, start clean.
3. If valid: the candidate becomes the CONTRACT INPUT STORY. Emit loudly:
   `Resuming final contract from repaired candidate (rounds=K, resolved=M,
   remaining=R)`. Full validation re-runs against it; the repair loop, if
   still needed, continues FROM it — accumulation achieved.
4. On this enforcement's own failure, overwrite the stored candidate only
   under the hill-climb rule; otherwise keep the prior (better) candidate so
   the NEXT resume starts from the best state ever reached.

## Phase C — Cross-resume monotonicity & the loop-breaker (~0.5d)

- `cumulativeIssueAttempts` accumulates per fingerprint across resumes
  (observability first; policy later — a fingerprint attempted ≥6 times
  across resumes is a candidate for W3.1 ship-with-cap, decided there, not
  here).
- Deterministic re-failure detector becomes meaningful: if a resume produces
  the IDENTICAL `remainingBlockingFingerprints` set AND an unchanged
  candidate hash, emit a structured advisory — "resume cannot progress;
  needs a code/gate change or fresh run" — in the failure payload the
  Generator UX shows. Advisory, not a block: the user decides.

## Phase D — Interactions audit (~0.5d, mostly tests)

- Un-frozen QA findings re-derive against the carried candidate (already the
  behavior post R0.5) — verify with a fixture.
- Deferred-realization records rehydrate alongside the candidate
  (`deferredFingerprints` pairing), so the episode-contract semantic pass
  sees the same handoff set the candidate was derived under.
- Receipt continuity (W3.2, future) keys receipts by scene hash — the
  carried candidate's hashes become the keys naturally; land THIS first.
- Reader-safety provenance unchanged: every candidate byte came from the
  same LLM repair handlers that produced it in-run.

## Phase E — Verification

- Unit: store/load round-trip; hash-mismatch discard; hill-climb overwrite
  (better replaces, worse is ignored); schema-version tolerance.
- Integration fixture: enforcement run 1 fails, persists candidate S1;
  enforcement run 2 over identical watermarks consumes S1 as input (assert),
  resolves the remaining finding, seals. Variant: watermark changed ⇒ starts
  from S0'.
- Live proof: the stranded 20-44-49 chain is the perfect subject — after
  landing, one more resume should log the carry-forward line and start from
  a story whose description fields are already re-authored.

## Explicitly not doing

- Trusting carried validation results (that's W3.2 receipts, scene-hash-
  gated, separate item).
- Cross-RUN carry (fresh runs recompile plans; watermark hash will not match
  by design).
- Any new blocking gate: every failure mode here degrades to today's
  behavior.

Total: ~2.5 focused days. Sequenced before W3.2 (receipt continuity) because
receipts should key on carried content, and after the current blocker set
clears (the mechanism is most valuable when repairs succeed and only
persistence is missing).
