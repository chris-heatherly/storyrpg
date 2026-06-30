# Consistency Plan — 2026-06-09

Goal: move from "high quality when a run survives" to "runs survive, and shipped quality is
trustworthy." Grounded in the quality ledger (75 runs: 42 failed / 33 success; 53 banded
`block`; last-20 success rate 5/20 — unchanged from first-20 despite avg score rising 51→78)
and the failure-class census across 68 error-bearing run dirs:

| Failure class | Runs |
|---|---|
| Scene-graph branch validation (reconvergence residue) | 16 |
| Final story contract | 15 |
| DramaticStructure / TreatmentFidelity (legacy, now advisory) | 15 |
| API credit exhaustion (full spend discarded) | 9 |
| Choice-related | 8 |
| JSON/parse, timeouts | 6 |

Companion finding: qaScore is miscalibrated — both g10 runs banded `ship` (qaScore 90) while
the 2026-06-09 human audit found verified BLOCKERs in them (dead-ended key reveal, POV/pronoun
collapse, misgendering, metadata-only DM). Every generation audit (gen-3/4/5/g10) found NEW
validator-missed blocker classes: detection is reactive, one generation behind.

Six workstreams. WS1 and WS2 attack run survival; WS3 and WS4 attack trustworthiness and the
promotion bottleneck; WS5 and WS6 are force multipliers.

---

## WS1 — Run survival: episode-granularity resume + billing pause + budget

**Why first:** 13% of runs died to credit exhaustion with all spend discarded; timeouts and
transient failures add more. Everything else in this plan gets cheaper once a failed run is a
pause, not a loss.

**What already exists (build on, don't rebuild):**
- Job-level resume: `resumeFromJobId` + `resumeContext` (proxy/generationJobRoutes.js:146),
  `WorkerPayload.resumeCheckpoint` (src/ai-agents/server/workerPayload.ts).
- Per-episode checkpoint files on disk: `checkpoints/episode-{N}/{blueprint,scene-*,choices-*,
  encounter-treatment-*}.json` (FullStoryPipeline.ts:2613).
- `partial-story.json` on late abort (FullStoryPipeline.ts:11448); `episodeRange.specific`
  supports mid-season resume; image resume already detects resolved vs missing slots.

**Gaps:** no episode-completion marker, checkpoint manifest isn't episode-indexed,
`getResumeOutput` is step-keyed only, billing errors classify as terminal failure, no budget
enforcement (ledger is post-hoc).

### 1a. Episode-complete watermarks + auto-resume (S)
- After each episode's full assembly, write `checkpoints/episode-{N}-complete.json`
  (timestamp, scene/choice/encounter counts, content hash of inputs).
- `detectCompletedEpisodes(outputDir)` helper; job `resumeContext.lastCompletedEpisode`.
- Resume flow: new job with `resumeFromJobId` skips completed episodes via
  `episodeRange.specific`, rehydrates world/character bibles and episode-state-snapshot from
  the prior run dir.
- Acceptance: kill a run after ep1 completes → resume produces a full story without
  regenerating ep1; ledger records `resumedFrom`.

### 1b. Billing/transient errors pause, never fail (S)
- Classify Anthropic 4xx billing errors (and 429/overloaded after retry exhaustion) in
  BaseAgent's Anthropic path → typed `ProviderQuotaError`.
- Worker maps `ProviderQuotaError` to a new job status `paused` (not `failed`), preserving
  `resumeContext`; proxy route `POST /generation-jobs/:id/resume`.
- Preflight: 1-token ping to the provider before starting a run; refuse to start on billing
  failure.
- Acceptance: simulate a 402 mid-episode-2 → job lands `paused`; resume after credit top-up
  completes the story with episodes 1..N-1 untouched.

### 1c. Budget enforcement + per-episode cost (M)
- Per-run token budget consumed from `ProviderCallMetric` (pipelineTelemetry.ts); `canSpend()`
  checked at phase boundaries; exceeding budget → `paused` with reason, not abort.
- Aggregate ledger per episode (episode key on PhaseMetric) so cost hot spots are visible.

---

## WS2 — "No blocking gate without a wired repair"

**Why:** the top two failure classes (scene-graph branch 16, final contract 15) are blocking
gates whose remediation is missing or under-powered. Detection without repair converts craft
gaps into zero-output runs.

### 2a. Reconvergence residue by construction (M) — kills the #1 failure class
- When BranchManager plans a reconvergence, emit a structured **residue requirement** into the
  target scene's blueprint: `{ reconvergedFrom: [pathA, pathB], requiredResidue:
  'conditionalText' | 'onShow' | 'callbackHook', flags: [...] }`.
- SceneWriter/ChoiceAuthor prompts receive the slot as a mandatory deliverable (same pattern
  as treatment anchors), so residue exists at authoring time instead of being hunted at
  validation time.
- SceneGraphBranchValidator keeps its check but its remediation becomes targeted
  `regen-scene` with the residue requirement injected into the retry prompt; abort only after
  the regen budget is exhausted, and then **degrade to advisory + ledger record** (the story
  ships with a recorded warning) rather than zero output.
- Acceptance: replay the validator over the corpus (WS4 harness) — the two g11 17:xx failures
  become either authored-by-construction passes or recorded warnings, never aborts.

### 2b. Gate audit: enumerate and close `remediation: 'none'` (M)
- Sweep validatorRegistry.ts for blocking entries with no repair path. For each: wire
  autofix, targeted regen, plan-time replan, or degrade-to-advisory-on-final-attempt.
- Allowlist the only legitimate aborts: unplayable structural corruption (broken nav,
  unparseable JSON) — and even those route through `StructuralValidator.autoFix()` /
  finalContractRepair first.
- Enforce by test: a registry test asserts every `blocking` entry has `remediation !== 'none'`
  unless allowlisted. New gates can't regress the policy.

### 2c. Converge hand-written loops onto `runGatedRemediation` (M, incremental)
- The hand-written retry loops in FullStoryPipeline predate the canonical driver; each behaves
  slightly differently. Migrate one gate per PR into `runGatedRemediation`, extracting the
  loop out of the monolith as you go (this is also WS6 progress).

---

## WS3 — QA recalibration: audit-corpus benchmark + LLM playthrough judge

**Why:** qaScore 90 on stories with human-verified BLOCKERs means the ship/warn/block bands
aren't decision-grade. The fix is (a) a ground-truth benchmark from the human audits, and
(b) judging the story **as a reader experiences it** (path-wise) rather than as artifacts.

**What already exists:** QAAgents.ts (ContinuityChecker/VoiceValidator/StakesAnalyzer,
weighted 35/30/35, threshold 70); storyPathAnalyzer.ts builds a scene DAG and computes a
minimal covering path set; playwrightQARunner.ts walks those paths in a real browser
(currently checks images/console/network, not narrative). `QA_LLM_MODEL` env override exists
for decorrelated judging but is unset. Missing: any LLM that reads a *path-realized* story.

### 3a. Labeled defect benchmark from the human audits (S)
- Convert the gen-3, gen-4, gen-5, and g10 audit findings into
  `qa-benchmark/defects.jsonl`: `{runDir, episode, sceneId, defectClass, severity,
  description}` (~30–40 verified blockers + the false-positive notes from the shadow audits).
- Add `npm run qa:benchmark`: runs the QA stack over those archived runs and reports
  **recall on known blockers** and FP rate on clean scenes. Record the baseline (expected:
  low recall — that's the point).
- Policy: any judge/validator change ships with its benchmark delta. qaScore regains meaning
  when its recall is measured, not assumed.

### 3b. LLM playthrough judge (L) — the core of the branch's QA system
- Reuse `storyPathAnalyzer` covering paths. For each path, deterministically realize the
  as-read text sequence (scenes in path order, with that path's conditional text, choice
  wording, encounter outcome tier, callbacks resolved — the engine's resolution logic, run
  headless; no browser needed for the narrative pass).
- A `PlaythroughJudge` agent reads each realized transcript and grades against the quality
  contract: continuity-as-experienced, POV/pronoun integrity, encounter substance (no hollow
  middles), payoff realization for promises made *on this path*, meta/design-note leaks,
  choice agency. Output **structured findings keyed to scene/beat IDs** so each finding can
  route to existing `regen-scene` / `regen-choices` remediation.
- Aggregate per-path verdicts into the episode/story qaScore; a blocker on any covering path
  blocks the band, not just the average.
- Cost control: judge on a cheap tier (Haiku) with a strong-model escalation only for
  flagged paths; sample paths beyond the covering set rather than enumerating all.
- Acceptance: recall ≥ ~80% on the WS3a benchmark blockers with acceptable FP on clean
  scenes, before it ever gates a live run (start shadow, promote via WS4 evidence).

### 3c. Decorrelate the judge (S)
- Set `QA_LLM_MODEL` to a different family/snapshot than the writer model; fail closed on
  judge parse failure (audit item C3). A judge that shares the writer's blind spots rubber-
  stamps them.

---

## WS4 — Offline replay harness in CI: drain the default-off backlog

**Why:** 17 gates sit default-off "pending one live confirmation run," but live runs are
expensive and die for unrelated reasons. The g10 shadow audit already proved replay-over-
archived-runs promotes gates in an afternoon with zero generation spend. Make that a tool,
not an afternoon.

### 4a. Replay CLI (S)
- `npm run replay:gates -- --corpus generated-stories --gates GATE_X,GATE_Y [--all-off]`:
  loads each archived run's story.json (+ blueprints/treatments where a validator needs
  plan-time inputs), runs the validators, writes a findings report per gate per run
  (counts, examples, wouldGate verdicts). Deterministic validators only by default; LLM-
  backed judges opt-in with a cost estimate.

### 4b. Golden corpus + CI job (M)
- Pin ~6 archived runs as a fixtures corpus (mix of ship-band and block-band, both titles).
  `generated-stories/` is gitignored — keep the corpus as a separate fetched bundle or a
  designated local path checked by the job; don't commit run dirs.
- CI (or a scheduled local job) replays **all default-off gates + any changed validator**
  against the corpus on every PR and diffs finding counts vs a committed baseline file.
  A validator change that alters corpus findings shows up in review, like a snapshot test.

### 4c. Promotion policy update (S)
- Detection gates promote on corpus evidence (zero FPs across the corpus) — no live run
  required. Live runs are reserved for confirming **generative repair paths** (the part
  replay can't exercise). Apply immediately to the 17-gate backlog; most are detection-side.
- Refresh the corpus each generation (add the newest ship + newest block run) so it tracks
  the pipeline's current failure surface.

---

## WS5 — Cost & model tiering: make iteration cheap

### 5a. Update the pinned model (S, do immediately)
- `config.ts:955` defaults to `claude-sonnet-4-20250514` (year-old snapshot). Move the
  default to the current Sonnet (4.6) via `LLM_MODEL`, A/B one full run against the ledger
  before flipping the default in code.

### 5b. Per-agent tiering for narrative agents (S)
- The config plumbing exists (per-agent AgentConfig; qaRunner/imagePlanner/videoDirector
  already have dedicated env overrides). Add the same for storyArchitect/sceneWriter/
  choiceAuthor (`ARCHITECT_LLM_MODEL`, `SCENE_LLM_MODEL`, `CHOICE_LLM_MODEL`).
- Tier: planning + prose on the strong model; judges, classifiers, repair loops, and the
  WS3b playthrough judge on Haiku 4.5. Track per-agent cost in the ledger to verify.

### 5c. Extend prompt caching (M)
- System prompts are already cached (BaseAgent.buildCachedSystemField). Add message-level
  `cache_control` breakpoints for the large stable context blocks repeated across calls
  within a run (world bible, character bible, season plan). Measure via the
  `cache_read_input_tokens` logging that already exists; report hit rate in the ledger.

---

## WS6 — Monolith decomposition (enabler, not a project)

- No big-bang. Every WS2c gate migration extracts its loop from FullStoryPipeline into a
  module under `remediation/`; WS1 episode-watermark logic lands in `pipeline/phases/`, not
  the monolith. Keep the line-count ratchet enforced so the file only shrinks.

---

## Sequencing

| Phase | Items | Outcome |
|---|---|---|
| **Week 1** | 1a, 1b, 5a | No more zero-output runs; current-model prose |
| **Week 2** | 2a, 4a, 5b | #1 failure class closed; replay tool; tiering live |
| **Weeks 3–4** | 3a, 3b (shadow), 4b, 4c, 2b | Benchmark + playthrough judge shadowing; backlog draining |
| **Ongoing** | 2c, 6, 5c, 1c, 3c | One gate per PR; caching + budget hardening |

## Metrics (all already land in or extend quality-ledger.jsonl)

- **Run success rate** — 25% today; target ≥70% after WS1+WS2a (failures become pauses).
- **Zero-output failures** — target 0: every failure leaves a resumable run dir.
- **Judge recall on the WS3a benchmark** — baseline unknown; target ≥80% before the
  playthrough judge gates anything.
- **Default-off gate backlog** — 17 today; target <5 within a month via WS4c.
- **Cost per shipped story** — from per-episode ledger; expect tiering + caching + resume to
  cut it substantially (resume alone stops paying for discarded episodes).

## Risks

- **Playthrough-judge cost**: covering paths × episodes × judge calls. Mitigate: Haiku tier,
  path sampling beyond the covering set, judge only changed episodes on resume.
- **Residue-by-construction overfit**: authors may satisfy the slot mechanically. Keep the
  validator as backstop; the WS3b judge grades residue *as experienced* on each path.
- **Corpus staleness**: a fixed corpus stops representing new failure modes. WS4c's refresh
  rule (add newest ship + newest block run each generation) addresses it.
- **`paused` job state** interacts with worker stale-detection (3-min timeout) — paused jobs
  must be exempt from the stale reaper (same class of bug as the QUEUED fix in a860111).
