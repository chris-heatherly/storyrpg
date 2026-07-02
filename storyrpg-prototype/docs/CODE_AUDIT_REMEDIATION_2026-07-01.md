# Code Audit Remediation Plan — 2026-07-01

Source: six-subsystem audit (pipeline architecture, LLM layer, validators/gates,
security/boundary, reader runtime, uncommitted diff) run 2026-07-01. Finding IDs
(C1…, H1…, M1…) reference that audit report.

## Ground rules (apply to every workstream)

- **Verify-then-fix**: reproduce each finding with a failing test BEFORE patching;
  the test is the exit criterion, not the patch.
- **Gate discipline**: any new gate flag goes in BOTH `remediation/gateDefaults.ts`
  and `remediation/gateRegistry.ts` (completeness test enforces).
- **Golden hygiene**: prompt-template edits must inline conditional blocks (a
  conditional block on its own line churns all prompt goldens even when empty).
  Run goldens without the reader dev server up (event-sequence goldens go flaky).
- **Commit hygiene**: commit explicit paths per workstream; never `git add -A`
  (the tree routinely carries parallel in-flight work). No parallel impl
  subagents in the shared worktree.
- **Typecheck**: `npm run typecheck:app` (base tsc stack-overflows).
- Full suite (`npm run validate`) green + zero unexplained golden churn before
  each phase's commit.

## Execution log

**2026-07-01 — Phase 0 complete + Phase 1 critical items (uncommitted, all tested):**
- ✅ **0.1 (C1, CRITICAL)** — proxy path traversal fixed. Extracted the
  `/generated-stories` route to `proxy/generatedStoriesStatic.js` with
  `resolveGeneratedStoryPath()` confining resolution to `STORIES_DIR`.
  `proxy/generatedStoriesStatic.test.ts` (11 tests) reproduces the traversal
  over raw HTTP (`../`, deep `../../etc/hosts`, `%2e%2e`) → all 404. Swept
  other proxy routes: no other `path.join(dir, req.*)` sites (fileRoutes
  already guards).
- ✅ **0.2 (H3, HIGH)** — added `maxOutputTokens` to `sceneContentSchema`
  (16384), `worldBibleSchema`/`worldLocations` (32000), `characterBibleSchema`
  (32000). Exported `structuredMaxTokens` and added
  `schemas/structuredMaxTokens.test.ts` (7 tests) proving the clamp preserves
  the configured budget. Confirmed no golden churn: prompt-snapshot
  `LlmTransportRequest` captures only `{agentName, provider, model, messages}`,
  not maxTokens.
- ✅ **1.1 (C2, CRITICAL)** — idempotent finalize. Added an in-memory
  `Symbol`-keyed finalized mark inside `finalizeEpisode`; a re-finalize of the
  same scene graph now skips the destructive body (was wiping routed
  `treatmentAtomIds`). Symbol → zero JSON/checkpoint/golden churn, correctly
  absent after reload. Double/triple-finalize byte-equality test added.
- ✅ **1.4 (H10, HIGH)** — safe encounter coercion in `ensureEncounterCapable`:
  default type `combat`→`dramatic`, `isBranchPoint` `true`→`false` (was
  manufacturing GATE_BRANCH_FANOUT aborts), skills derived from the scene plan
  before the neutral fallback.

Verification: 535 tests green across schemas/agents/utils/proxy;
`typecheck:app` clean. NOT committed (per commit-only-when-asked).

**2026-07-01 (later) — Phase 1 COMPLETE (uncommitted, tested):**
- ✅ **1.2 (H11)** — SceneWriter `buildTreatmentEventPromptSections` filters owned
  atom ids out of the "Non-Copyable Source Context" list (kept in payload for
  text resolution). Zero golden churn (no goldens exercise that section).
- ⏭️ **1.3 (H12) — VERIFIED NON-ISSUE, no change.** A standard (non-encounter)
  atom has empty requiredLocations/entities and no cues, so it gets no
  target-side score while the source scene always wins tokenOverlap + the +1
  self bonus. Cross-scene routing therefore only ever lands on ENCOUNTER owners
  (which `ensureEncounterCapable` already binds via `encounter.requiredBeats`).
  The "enforcement gap" is unreachable under current scoring; a NOTE documents
  it in `episodeSceneOwnership.ts` instead of shipping untestable dead code.
- ✅ **1.5 (M13)** — `sceneLocationCues.ts`: `isDirectLocationLabel` is now a
  positive "looks like a place" test (venue noun / container / proper name), so
  prose fragments no longer inflate the multi-location count; container-only cue
  sets collapse to one; preposition alternation made case-insensitive
  (sentence-initial "Through"/"In" now match); +`dock`/`estate`. New
  `sceneLocationCues.test.ts` (10 tests incl. both FP repros).
- ✅ **1.6 (H7)** — `GATE_SCENE_CONSTRUCTION_PREFLIGHT` registered in gateDefaults
  + gateRegistry (blocking, default-ON, repair regen); all three throw sites
  (StoryArchitect ×2, ContentGenerationPhase) routed through `isGateEnabled` so
  detection still runs but the abort has a kill-switch;
  `SceneOwnershipPreflightValidator` added to VALIDATOR_REGISTRY.
- ✅ **1.7 (M15)** — `applySceneConstructionProfilesToScenes` re-attaches profiles
  AFTER the drain so returned diagnostics and downstream-read obligations
  reflect post-drain state.
- ✅ **1.8 (M16)** — `buildSceneStakesLadder` joins the derived value + register
  suffix so an empty derivation yields a clean line, not malformed
  `"REST:  establishes…"`.
- ✅ **1.9 (M14)** — signature-moment routing no longer steals a signature from a
  scene that owns its own cue, and never drops the source's signature on
  collision (only relocates to a scene without an existing signature).
- ✅ **1.10** — removed dead `KEY_BEAT_STAGE_RE`, unified order sentinel to
  `Number.MAX_SAFE_INTEGER` (validator + construction profile), removed unused
  `'pipeline_preflight'` stamp-source union member.

Verification: 1947 tests pass across all touched areas; `typecheck:app` clean;
lint 0 errors (pre-existing console warnings only, none added). The 2 failures
in `relationshipArcEnforcement.test.ts` are **pre-existing at HEAD** (confirmed
by running with the entire working tree stashed) — unrelated to this work; HEAD
b4a275ee is itself partially red. NOT committed.

**1.11 (commit)** — done: user checkpointed d85db108 mid-session (Phase 0 +
early Phase 1); aa965d1e completes Phase 1.

**2026-07-01 (later) — Phase 2 COMPLETE (tested):**
- ✅ **2.1 (H1)** — removed all 27 `EXPO_PUBLIC_*` provider-key/token reads from
  bundled code (config.ts, buildPipelineConfig, draftImageGeneration,
  regenerate-image, image/video/audioGenerationService); `.env.example` now
  shows `GEMINI_API_KEY`; local `.env` migrated in place (server-side name
  added). Proxy files keep legacy fallbacks deliberately — server-side Node,
  never bundled. NEW GUARD: `scripts/noBundledSecretEnvReads.test.ts` fails CI
  on any secret-shaped EXPO_PUBLIC read in src/ or apps/ (PostHog exempt).
- ✅ **2.2 (H2)** — `scripts/scan-bundle-secrets.mjs` + npm scripts
  `check:generator-bundle` / `verify:generator` (export + strict scan of
  dist-generator-internal for secret values + provider-key shapes). CI teeth
  come from the source-level guard test (runs in `npm test`); the full bundle
  scan is for pre-expose/deploy.
- ✅ **2.3 (M1/M2)** — exposure guard no longer blanket-exempts GET/HEAD: only
  the public reader endpoints (`/list-stories`, `/stories/*`,
  `/deleted-stories`, `/audio-alignment`, `/check-builtin-stories`,
  `/generated-stories/*`) pass unauthenticated; OPTIONS stays exempt (CORS).
  `/generator-settings` GET now redacts via sanitizeJobState; POST/PATCH
  reject non-objects and drop `[redacted]` values (round-trip-safe). New
  `generatorSettingsRoutes.test.ts` + 2 new guard tests (the old
  blanket-GET-passes test was asserting the vulnerability; replaced).
- ✅ **2.4 (M3)** — boundary checker now follows dynamic `import()`/`require()`
  string literals; verified red→green with a planted
  `import('../../src/ai-agents/config')` in ReaderApp.tsx.
- ✅ **2.5 (L1/L5)** — worker payload files written mode 0o600 (cleanup on close
  already existed); `resolveSessionSecret` now FAILS startup (throws) instead
  of warning when SESSION_SECRET is missing under NODE_ENV=production or
  PROXY_REQUIRE_AUTH=1.

Verification: proxy suite 56 green (incl. new tests), guard test green,
key-resolution suites 211 green, `node --check` on all edited server files,
`typecheck:app` clean, `check:reader-boundary` clean.
NOTE for operators: keys must now be set under their server-side names
(GEMINI_API_KEY etc.) — EXPO_PUBLIC names are ignored by src/ code.

**2026-07-01 (later) — Phase 3 COMPLETE (tested):**
- ✅ **3.1 (H4)** — streaming truncation parity: `anthropicSseHandler` captures
  `message_delta.stop_reason`, `openaiSseHandler` captures
  `choices[0].finish_reason` (shared by OpenRouter); all three streaming
  consumers now throw the typed `TruncatedLLMResponseError` on a max_tokens cut
  (+ Anthropic stream empty-content error). 4 new SSE fixture tests.
- ✅ **3.2 (M7)** — new `clientTimeoutSignal` helper (5 min / 15 min ≥32k
  budget, chained to the per-call signal) applied to the buffered
  Anthropic/OpenAI/OpenRouter fetches — a stalled structured call can no
  longer hold guardrail permits for undici's 22-min ceiling.
- ✅ **3.3 (M8)** — deleted dead `callAnthropicWithMemory` (159 lines, zero
  callers, two latent bugs) + the `useMemory` option plumbing.
- ✅ **3.4 (M9)** — `handleTruncation` now does ONE string-aware scan: a literal
  `},` inside prose can never be the cut point, and escape handling counts
  backslash RUNS (`\\"` is a real delimiter). 2 new regression tests including
  a decoy-`},`-in-string recovery proof.
- ✅ **3.5 (M6)** — `encounterAgent` budget 20→25 min; new
  `EncounterArchitect.worstCasePhaseBudgetMs()` computes the all-retries-slow
  worst case (1,324s) from the LIVE constants (phase timeouts, attempts,
  phase-2 concurrency, schema choice cap) and a unit test asserts it fits under
  the outer budget — the "600s timeout" class can't recur silently a third time.
- ✅ **3.6** — abort classification consults the per-call signal (F5); Anthropic
  buffered empty-content throws descriptively like the other 3 providers (F8);
  quota matcher single-sourced (`isQuotaMessage` delegates to `isLlmQuotaError`,
  F12); image agents use `PROXY_CONFIG.getProxyUrl()` instead of hardcoded
  `localhost:3001` (F11); OpenRouter fusion no-op branch removed (F14); stale
  undici "16 min" comment corrected to 22 (F12 tail).
- ⏭️ Deferred by design: model-slug drift table (F9), display-name timeout tiers
  (F10), parse-retry convention unification (F13), per-provider circuit breaker
  (F15) — documented, low risk, judgment calls.

Verification: typecheck:app clean; 511 agent/schema/timeout tests green; FULL
suite 3,909 pass with exactly 6 failures — ALL verified pre-existing before
this session (4 promptSnapshot/runGraphParity goldens fail at 19e91ad8, two
checkpoints back; 2 relationshipArcEnforcement fail at HEAD with the entire
tree stashed). Bisect worktree used and removed.

**KNOWN-RED BASELINE (pre-existing, NOT from this remediation):**
`FullStoryPipeline.promptSnapshot{,.branching,.season}` +
`runGraphParity.season` (scene-2 "MISSING CHOICE POINT" hard issue) and
`relationshipArcEnforcement` ×2. These predate the audit and block `npm run
validate` — triage separately before the Phase 7 live run.

**RESOLVED 2026-07-01 (follow-up session).** All six were introduced by
19e91ad8 ("Checkpoint StoryRPG pipeline validation work"):
1. The scene-event-ownership prompt sections added turn-contract handoff lines
   ("Hand forward to scene-3 …") that name *neighboring* scene ids inside a
   scene's SceneWriter prompt. `fullRunFixtures`' Scene Writer responder
   matched any `scene-N` substring (scene-3 first), so the scene-2 write was
   answered with the scene-3 fixture — which has no `isChoicePoint` beat →
   hard "MISSING CHOICE POINT" abort. Fix: match the `**Scene ID**:` marker
   (same pattern branching/season fixtures already used), with scene-name
   fallback for markerless rewrite prompts.
2. The same commit's `effectiveTargetStage` clamp in
   `RelationshipArcLedgerValidator` forgave over-eager pacing targets for ALL
   contract sources, silencing the blocking behavior the enforcement tests
   pin. Fix: clamp only derived sources (`planner`/`encounter`); `treatment`/
   `choice` contracts are enforced strictly again.
Also fixed a third `validate` blocker found on the way: `streamLLM.test.ts`
read `result.usage.outputTokens` on optional `usage` (typecheck:test error,
from the Phase 3 commit) → `usage?.`.
Goldens for all four pipeline tests regenerated AFTER verifying the runs
complete with `success=true` (the diffs are the intended ownership-section /
turn-audit prompt churn plus the extra advisory MISSING_MECHANICS_HOOK
revision rounds). `npm run validate` exits 0 (4 tsconfigs, lint 0 errors,
3,915 tests).

**2026-07-01 (later) — Phase 4 items 4.1–4.5 (tested; 4.6/4.7 deferred):**
- ✅ **4.1 (H5)** — deleted the 4 dead repair-infra gates
  (GATE_SEASON_PROMISE_REPAIR / CHARACTER_TREATMENT_REPAIR /
  FAILURE_MODE_AUDIT_REPAIR / MECHANIC_PRESSURE_REPAIR) from both registries:
  their violation classes repair via the GENERIC final-contract loop; the
  dedicated routers were never built, so the flags advertised a no-op
  kill-switch.
- ✅ **4.2 (H6)** — migrated all 8 out-of-registry flags into
  gateDefaults+gateRegistry (SEASON_BUDGETS, CHARGE_MATERIALIZATION,
  INTENSITY_DISTRIBUTION, MECHANICS_LEAKAGE_REGEN, REGEN_CHOICES,
  TREATMENT_FIDELITY, THEME_PRESSURE, EPISODE_PRESSURE — all default-OFF,
  behavior preserved); raw `process.env.GATE_X==='1'` reads switched to
  `isGateEnabled`. NEW META-GUARDRAIL `gateSourceSweep.test.ts`: (a) any quoted
  or process.env GATE_* literal in src/ must be registered; (b) every
  registered gate must have ≥1 call site (would have caught both 4.1 and 4.2
  classes — verified 0/0 on the current tree).
- ✅ **4.3 (H8)** — repair budget charged on ATTEMPT, not selection:
  `ContractRepairResult.attemptedIssueKeys` (exported
  `contractRepairIssueFingerprint`); scene-prose (cap 4/round) and cluster
  (cap 2/round) handlers report attempted keys; legacy handlers keep old
  charging. g23-shape regression test: 10 scene issues / cap 4 /
  maxAttemptsPerIssue 2 → all 10 attempted, none exhausted-without-attempt.
- ✅ **4.4 (M10)** — repair-first now applies to gates whose `auditPlacements`
  include season-final (not just primary placement). The 3 flagged offenders
  (AUTHORED_EPISODE_CONFORMANCE, INFORMATION_LEDGER_SCHEDULE,
  STORY_CIRCLE_ANCHOR_CONFORMANCE) carry written policyExceptions naming the
  planned fix (route authored_contract findings through scene-prose/cluster
  repair). Registry test updated: a season-final regression-net blocking gate
  without repair is now a VIOLATION (the old test pinned the blind spot).
- ✅ **4.5 (M11/M12)** — new tier-vs-gate cross-check in
  `validateValidatorOwnershipRegistry` (advisory row + default-ON blocking gate
  = violation); it enumerated **12** stale rows (audit predicted 3) — all
  promoted to `tier: 'blocking'`. Direct tests for
  `resolveFinalContractSeverity` added (documents the unconditional
  craft_critic→warning downgrade). NOTE: the 18 validators absent from
  VALIDATOR_REGISTRY are still absent — adding entries needs per-validator
  stage/dispatch knowledge; deferred.
- ⏭️ **4.6 (C3)** — monolith ratchet burn-down deferred: it is the
  runGraph-adoption refactor (decompose generate()/generateMultipleEpisodes),
  gated on the Phase 7 live run per the original waves plan. The ratchet
  process hole (how did +1,525 land with CI?) still needs a look at CI logs.
- ⏭️ **4.7 (M5)** — typed phase-deps unwind (11 casts) deferred with 4.6 (same
  decomposition work).

**2026-07-01 (later) — Phase 5 reader sprint (major items; tested + browser-verified):**
- ✅ **5.1 (H13)** — StoryReader beat effect gets a same-beat-key early return:
  onShow consequences, 'beat viewed' analytics, and processBeat/animation now
  run ONCE per beat (the effect depends on player.visitLog, which its own
  visitBeat call mutates — it was re-firing for its own update, applying onShow
  2-3x per beat).
- ✅ **5.2 (H14)** — applyConsequences: preview-then-commit via a FUNCTIONAL
  updater (recomputes iff another updater interleaved) — no longer overwrites
  loadScene's concurrent updates or resurrects fired butterflies. loadScene's
  delayed-consequence pass rewritten PURE (no in-place dc mutation, no closure
  feedback array) with the same preview/commit pattern.
- ✅ **5.3 (H15/H19)** — navigation persist now WRITES story/episode/scene ids
  (they were read at hydration but never written); hydration exposes
  `savedResumePoint` on the story context for the app layer to implement
  cross-restart resume. Player saves stamped with `saveVersion` (v1) and
  deserialization defaults EVERY map/collection (v0 saves with missing
  attributes crashed the evaluator / NaN-poisoned consequences). New
  playerStatePersistence.test.ts.
- ✅ **5.4 (H16/H17/H18 + guards)** — flag condition without `value` means "is
  set" (was permanently false); and/or tolerate missing conditions arrays;
  attribute compare defaults 0; dangling choice nextSceneId falls through to
  beat/next-scene instead of soft-locking; `encounter.outcomes?.[...]` guard at
  encounter end; `loadScene` tolerates beats-less scenes; episode-delayed
  butterflies FIRE now (completeEpisode advances episodesElapsed and converts
  due ones to immediately-due scene delays). Regression tests in
  conditionEvaluator.test.ts.
- ✅ **5.5 (H21/M18)** — `JSON.stringify(beat.content)` prose fallback removed
  (falls through to readerSafeBeatFallback); `{{npc.X.trust}}` renders a
  qualitative word, `{{score.X}}`/`{{flag.X}}` stripped with warnings
  (fiction-first); NPC ids regex-escaped in templates; developer-mode section +
  `window.__QA_FORCE_TIER` gated behind `__DEV__` (no e2e test used the hatch;
  Playwright targets the dev server).
- ✅ **5.6 (H20 + M19 tail)** — completedEncounters/encounterStartedRef reset on
  episode/story change (encounters no longer silently skipped on replay);
  loadEpisode clears stale scene/beat.
- ✅ **NarrativeText hardening** — typewriter progress is elapsed-time based:
  browser-throttled ticks catch up in a burst instead of crawling/freezing.
- ⏭️ Deferred: 5.3 app-layer resume UX (HomeScreen "continue" consuming
  savedResumePoint), 5.4 hostile-story-JSON corpus, per-episode snapshot
  rollback on replay, stat-check strand fix (M19), initializeStory defaults.

Verification: 192 engine/store/component tests green (incl. new persistence +
condition-tolerance tests); typecheck:app + reader:typecheck clean; reader
boundary clean. BROWSER-VERIFIED against the live Bite Me story: library →
episode → 10+ beats → choice point with 3 choices, full prose, no console
errors. The typewriter/transition stalls observed in the harness reproduce
IDENTICALLY on stashed baseline code (throttled hidden-tab rAF/timers — an
environment artifact, not a regression); the time-based typewriter measurably
improves throttled typing (209 chars/4s vs ~4/s baseline). Also provisioned
SESSION_SECRET in local .env (required by the Phase 2 fail-hard with
PROXY_REQUIRE_AUTH=1).

Phases 6 and 8 not started.

## Sequencing overview

| Phase | Theme | Blocking? | Size |
|---|---|---|---|
| 0 | Stop the bleeding (same day) | — | XS |
| 1 | Working-tree rescue (before ANY commit of current diff) | blocks committing | M |
| 2 | Proxy & key security hardening | after 0 | S–M |
| 3 | LLM transport reliability | independent | M |
| 4 | Gate-system integrity + meta-guardrails | independent | M |
| 5 | Reader runtime repair sprint | independent | L |
| 6 | De-overfit heuristics (story lexicon extraction) | after 1 | M |
| 7 | The live `=1` run + promotion-queue drain + runGraph flip | after 1–4 | gated on credits |
| 8 | Dead-code & doc-drift cleanup | anytime | S |

Phases 2–5 are mutually independent and can interleave. Phase 7 is the single
highest-leverage unlock (17 shadow gates, runGraph, WS-H, blocking promotions
all queue behind it) but depends on 1 & 4 landing so the run exercises the
fixed code.

---

## Phase 0 — Stop the bleeding (same day, ~1 hour)

### 0.1 Fix proxy path traversal (C1) — CRITICAL
- File: `proxy-server.js:98-118` (`/generated-stories` static route).
- Fix: resolve-and-confine, mirroring `resolveInside()` from
  `proxy/artifactRoutes.js:15-20`:
  `const abs = path.resolve(STORIES_DIR, '.' + req.path);` reject unless
  `abs === STORIES_DIR || abs.startsWith(STORIES_DIR + path.sep)`.
- Tests: route test asserting `../../etc/hosts`-style requests → 404 (raw
  request, not browser-normalized); existing story-file fetches still 200.
- Also sweep every other `path.join(<dir>, req.*)` in `proxy-server.js` +
  `proxy/` for the same shape.

### 0.2 Structured-output token caps (H3) — one line per schema
- Add `maxOutputTokens` to `sceneContentSchema.ts` (16384),
  `worldBibleSchema.ts` (32000), `characterBibleSchema.ts` (32000) — match the
  documented A/B evidence in `config.ts:1153-1157` and the F8 force at
  `FullStoryPipeline.ts:980-986`.
- Consider raising `structuredMaxTokens` defaultCap 8192→16384 as belt-and-braces,
  but the explicit schema caps are the real fix.
- Test: unit test asserting effective maxTokens for SceneWriter/WorldBuilder/
  CharacterDesigner structured calls ≥ configured value (regression guard so a
  future schema loses its cap loudly).

### 0.3 Quarantine the working tree
- Do NOT commit the scene-ownership diff until Phase 1 exits. Stash-free: it
  stays in the tree; Phase 0 commits are explicit-path only
  (`proxy-server.js`, the three schema files, new tests).

---

## Phase 1 — Working-tree rescue (scene-ownership diff)

Goal: make the uncommitted preflight work idempotent, enforceable, and
non-destructive, then commit it. Exit: all items below green, `npm run validate`
green, golden churn explained line-by-line.

### 1.1 Idempotent finalize (C2) — CRITICAL
- Root cause: `finalizeEpisodeSceneOwnership` drains routed contracts from
  source scenes; `clearStaleOwnership` on re-run wipes
  `treatmentAtomIds`/`nonCopyableContext` and re-derives from the drained
  contracts → routed facts vanish. Pipeline runs finalize 2–3×.
- Fix options (pick A unless it fights the resume path):
  - **A (preferred)**: make the pass genuinely idempotent — persist routing
    decisions on the scene (e.g. `routedOwnership` record survives
    `clearStaleOwnership`) so re-runs re-derive the same result; OR
  - **B**: make `sceneOwnershipStamp` version check actually SKIP
    re-finalization (today it only logs) at both `FullStoryPipeline.ts:2031`
    and `ContentGenerationPhase.ts:480`.
- Tests (required, both): (a) double-finalize test — run finalize twice over
  the existing fixture, assert byte-equal scene output; (b) triple call-site
  integration test — plan-time apply → content-phase finalize → resume
  finalize, assert the routed atom still reaches SceneWriter prompt sections
  (`SceneWriter.ts:486-497` "Primary Owned Facts").

### 1.2 Contradictory prompt instructions (H11)
- `addPrimaryAtom` → `addAtomPayload` puts owned atoms into
  `nonCopyableContext`; `buildTreatmentEventPromptSections` then marks the same
  text "must not be paraphrased" AND "must stage".
- Fix: exclude ids present in `treatmentAtomIds` from the Non-Copyable section
  (keep the payload for text resolution; filter at prompt-build).
- Test: prompt-section unit test — owned atom appears in Primary Owned Facts
  only.

### 1.3 Non-encounter route enforcement gap (H12)
- Routed required beats on a non-encounter target must survive into something
  `RequiredBeatRealizationValidator` enforces (today: only `treatmentAtomIds` +
  an obligation that no-ops when target has no compiled profile).
- Fix: when draining a routed beat to a non-encounter target, materialize an
  equivalent `requiredBeats` entry (or beat contract) on the target — symmetric
  with the encounter path's `encounter.requiredBeats`.
- Test: non-encounter routed beat → assert target carries an enforceable
  contract and the realization validator sees it.

### 1.4 Encounter coercion made safe (H10)
- `ensureEncounterCapable` currently forces `kind:'encounter'`,
  `type:'combat'`, `relevantSkills:['notice','composure']`,
  `isBranchPoint:true` off lexical cues.
- Fixes: (a) drop `isBranchPoint:true` (let branch planning decide — a
  synthesized branch point without fan-out manufactures GATE_BRANCH_FANOUT
  aborts); (b) type default `'confrontation'`/neutral rather than `'combat'`,
  or derive from cue class; (c) derive `relevantSkills` from the scene's skill
  plan, not hardcoded; (d) put the coercion behind a registered gate flag
  (see 1.6) so it has a kill-switch.
- Test: dramatic-non-combat fixture (nightmare/argument w/ "scream",
  "fight back") NOT coerced when hint absent; coerced scene passes branch-fanout
  preflight.

### 1.5 sceneLocationCues correctness (M13 + diff findings 3/4/7/8)
- (a) `isDirectLocationLabel`: require a location-shaped candidate (leading
  article/proper-noun/venue noun) instead of "≤48 chars, no punctuation, no
  deny-listed verb" — reproduce first with the two audit repros
  ("A shadow moves behind the trees"; container-only fallback).
- (b) container fallback: when `specific.length === 0`, return at most ONE
  container cue (containers can't conflict with themselves).
- (c) move `cismigiu`/`valcescu`/city list to per-story lexicon config
  (Phase 6 owns the mechanism; here just mark TODO + keep behavior).
- (d) case-insensitive preposition alternation in
  `extractNamedAuthoredLocation` (`StoryArchitect.ts:3893`) + re-check the
  test at `StoryArchitect.test.ts:3229` that currently passes because of the
  miss.
- (e) NEW dedicated test file `sceneLocationCues.test.ts` — the shared util is
  currently only tested via consumers.
- (f) unify order sentinel (use `Number.MAX_SAFE_INTEGER` everywhere; kill the
  `999`s in `SceneOwnershipPreflightValidator.ts:54` / `openingSceneIds`).

### 1.6 Register the SceneConstructionGate (H7)
- Add `GATE_SCENE_CONSTRUCTION_PREFLIGHT` to gateDefaults + gateRegistry
  (blocking, default-ON is fine — but it now HAS a kill-switch and shows up in
  policy tests). Route the throws at `ContentGenerationPhase.ts:527-537` and
  `StoryArchitect.ts:3941,4376` through `isGateEnabled`.
- Add `SceneOwnershipPreflightValidator` + new utils to `VALIDATOR_REGISTRY`.

### 1.7 Post-drain diagnostics + stale profiles (M15)
- `applySceneConstructionProfilesToScenes`: recompute
  `attachSceneConstructionProfiles` (and event-ownership profiles) AFTER the
  apply/drain mutation; return post-normalization diagnostics.
- Test: fixture where apply fixes the only error → callers see zero
  diagnostics, no resume invalidation; drained threat beat no longer marks the
  source scene as owning `threatEncounter`.

### 1.8 Stakes ladder register leak (M16)
- `buildSceneStakesLadder`: (a) preserve non-generic existing keyBeats (merge,
  don't replace); (b) strip the planning-register boilerplate from synthesized
  lines or mark them prompt-only so GATE_PLANNING_REGISTER_PROSE can't be
  tripped by our own scaffolding; (c) fix the empty-derivation malformed
  "REST:  establishes…" lines.

### 1.9 Signature-moment routing (M14)
- Check whether the CURRENT scene matches the cue before stealing; on
  collision (target already has a signatureMoment) keep both (append) or leave
  source untouched — never silently drop. Add steal + collision tests.

### 1.10 Small diff cleanups
- Delete unused `KEY_BEAT_STAGE_RE`; remove or wire `'pipeline_preflight'`
  stamp source; pick one empty-collection convention (`undefined` vs `[]`) for
  drained `requiredBeats`; add a warning log when
  `finalizeEpisodeSceneOwnership` skips a scene with no episode number.

### 1.11 Commit
- Explicit paths, one commit per logical unit (utils, validator, pipeline
  wiring). Note: HEAD is currently broken (b4a275ee removed
  `repairRooftopSetupDensity` but committed tests still call it — this diff
  fixes that); land the test fix first so bisect stays clean.

---

## Phase 2 — Proxy & key security hardening

### 2.1 Kill EXPO_PUBLIC key fallbacks (H1)
- `src/ai-agents/config.ts:1061-1069` and
  `pipeline/draftImageGeneration.ts:625-637`: remove every
  `EXPO_PUBLIC_*_API_KEY` read; server-side names only. If the generator web
  UI needs key entry, it must flow through the proxy, never the bundle.
- Test: static check (see 2.2) + unit test that config resolves keys from
  server-side names only.

### 2.2 Generator bundle secret scan (H2)
- Extend `scripts/check-reader-boundary.mjs` (or add `verify:generator`) to
  sweep `dist-generator/` with the same secret-value scan as `verify:reader`.
  Wire into CI next to the reader check.

### 2.3 GET auth exemption (M1) + generator-settings (M2)
- `proxy/proxyGuards.js:94-108`: replace blanket `SAFE_METHODS` bypass with an
  explicit allow-list of safe GET paths when exposed; everything else requires
  auth regardless of method.
- `proxy/generatorSettingsRoutes.js`: redact on read (reuse
  `sanitizeJobState` key patterns), constrain accepted POST/PATCH shape to the
  known settings schema.

### 2.4 Boundary checker dynamic imports (M3)
- `scripts/check-reader-boundary.mjs:81-108`: add `import(...)` and
  `require(...)` regexes; resolve tsconfig path aliases (or fail loudly on
  unknown non-relative specifiers instead of returning null).

### 2.5 Low-severity hardening
- Worker payload files: `proxy/workerLifecycle.js:1126-1134` — write with
  `mode: 0o600`, delete on completion.
- `authRoutes.js:56-67`: fail (not warn) on missing SESSION_SECRET when
  `NODE_ENV === 'production'` or PROXY_REQUIRE_AUTH=1.

---

## Phase 3 — LLM transport reliability

### 3.1 Streaming truncation parity (H4)
- `streamLLM.ts`: capture `message_delta.stop_reason` (Anthropic) and
  `choices[0].finish_reason` (OpenAI/OpenRouter) in the SSE handlers; throw
  `TruncatedLLMResponseError` from `callAnthropicStreaming` /
  `callOpenAIStreaming` / `callOpenRouterStreaming` on truncation, matching the
  buffered paths and Gemini streaming.
- Tests: SSE fixture per provider with a truncated finish reason → typed error
  (not parse failure).

### 3.2 Client-side timeout on buffered calls (M7)
- Port Gemini's AbortController timeout (BaseAgent.ts:1560-1568) to the
  buffered Anthropic/OpenAI/OpenRouter paths (all structured calls use these).
  Sizing: reuse the per-tier proxy hint values.
- Follow-up: audit `withTimeout` call sites that abandon rather than abort
  (e.g. `ContentGenerationPhase.ts:1844`) — prefer `withTimeoutAbort` where a
  signal can reach BaseAgent, so semaphore permits are released.

### 3.3 Delete dead memory path (M8)
- Remove `callAnthropicWithMemory` + `useMemory` plumbing (158 lines, zero
  callers, two latent bugs). If memory is wanted later, rebuild on the current
  transport.

### 3.4 Truncation-recovery string-awareness (M9)
- `handleTruncation`: replace `lastIndexOf('},')` raw scan with a
  string-aware scan (track in-string state); fix escaped-backslash parity in
  `hasBalancedJsonQuotes`. Add prose-with-`},`-inside-string fixture.

### 3.5 Encounter budget arithmetic (M6)
- Either raise `PIPELINE_TIMEOUTS.encounterAgent` above worst-case
  (2×180 + 2×2×240 + 2×180 + 2×180 = 1,800s) or cap phase-2 retry waves so the
  sum fits 1,200s. Add a unit test that computes worst-case from the constants
  and asserts it ≤ the outer budget (prevents the third recurrence of this
  exact bug class).
- Fix stale comments ("10-min budget"; withTimeout's "16 min" undici note).

### 3.6 Smaller transport items
- Abort classification: consult the per-call `signal` (not just
  `activeAbortSignal`) in `classifyLlmError` inputs (F5).
- Anthropic empty-content: throw descriptive error like the other three
  providers (F8).
- Quota-matcher: single source (`isLlmQuotaError` vs `isQuotaMessage`) (F12).
- Model-slug drift table (F9) + display-name timeout tiers (F10) + hardcoded
  `localhost:3001` in image agents (F11): centralize in config; use
  `PROXY_CONFIG.getProxyUrl()`.
- Decide + document the parse-retry convention (F13): `callLLMForJson` for
  planners; note the deliberate exceptions inline.
- Circuit breaker per-provider keying (F15): optional; do only if a
  cross-vendor preset run is planned.

---

## Phase 4 — Gate-system integrity + meta-guardrails

### 4.1 Dead repair-infra gates (H5)
- For each of GATE_SEASON_PROMISE_REPAIR / CHARACTER_TREATMENT_REPAIR /
  FAILURE_MODE_AUDIT_REPAIR / MECHANIC_PRESSURE_REPAIR: either wire the flag
  at the repair site it was meant to gate, or delete it AND re-examine the
  companion blocking gate's `repair: 'regen'` claim (if the repair never
  existed, the blocking gate may be violating repair-first policy — demote or
  build the repair).

### 4.2 Registry escape hatch (H6)
- Migrate the 8 out-of-registry flags (GATE_SEASON_BUDGETS,
  GATE_CHARGE_MATERIALIZATION, GATE_INTENSITY_DISTRIBUTION,
  GATE_MECHANICS_LEAKAGE_REGEN, GATE_REGEN_CHOICES, GATE_TREATMENT_FIDELITY,
  GATE_THEME_PRESSURE, GATE_EPISODE_PRESSURE) into gateDefaults + gateRegistry
  and replace direct `process.env[...] === '1'` reads with `isGateEnabled`.
- **Meta-guardrail**: extend `validateGateRegistry` to (a) sweep the source
  tree for `GATE_[A-Z_]+` literals not present in GATE_DEFAULTS (CI fails on
  strays), (b) assert every registered gate has ≥1 `isGateEnabled` call site
  (kills the H5 class permanently).

### 4.3 Repair budget accounting (H8)
- `finalContractRepair.ts:335-337`: charge `issueAttempts` only for issues a
  handler actually attempted this round (handlers return attempted keys;
  selection ≠ attempt). Regression test: >8-scene failure set with
  maxScenesPerRound=4 → every issue receives ≥1 repair attempt before the
  loop can abort. This is the g23 74-blocker abort class.

### 4.4 Placement blind spot (M10)
- `validateGateRegistry`: apply the repair-first requirement to any gate whose
  `auditPlacements` includes `'season-final'`, not just
  `placement === 'season-final'`. Then fix the three offenders
  (GATE_AUTHORED_EPISODE_CONFORMANCE, GATE_INFORMATION_LEDGER_SCHEDULE,
  GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE): declare a repair route or downgrade
  their season-final severity.

### 4.5 Validator registry truth (M11) + severity chokepoint (M12)
- Reconcile stale tiers (CharacterIntroduction, TreatmentSeedOnPage,
  SceneGraphBranch → blocking) and add the 18 missing validators.
- **Meta-guardrail**: extend `validateValidatorOwnershipRegistry` to
  cross-check `entry.tier` against the gate's registry kind/defaultOn so
  promotions can't silently bypass the remediation-metadata rule.
- Add direct tests for `resolveFinalContractSeverity`; document (or fix) the
  unconditional `craft_critic` → warning downgrade.

### 4.6 Monolith ratchet recovery (C3)
- First: find out why CI let 10,961 > 9,436 land (red main? bypassed checks?
  ratchet baseline edited?) — fix the process hole.
- Then burn down: extract from `generate()` (1,438 lines) /
  `generateMultipleEpisodes()` (1,176) / `generateEpisodeFromOutline()` (705)
  toward the runGraph adoption plan until under baseline. Do NOT re-baseline
  upward.
- Extend the ratchet to second-generation monoliths:
  `ContentGenerationPhase.ts` (3,413), `SceneImagePhase.ts` (2,544),
  `EncounterImagePhase.ts` (2,003), `seasonScenePlanBuilder.ts`,
  `finalContract.ts` — baseline at current size so they can only shrink.

### 4.7 Phase-deps type safety (M5)
- Replace the 11 `satisfies Partial<X> as unknown as X` casts with real typed
  wiring (construct the full deps object; where a dep is intentionally
  omitted, make it optional in the phase's Deps type). Compiler catches
  missing deps instead of runtime `undefined`.

---

## Phase 5 — Reader runtime repair sprint

Order matters: 5.1/5.2 corrupt state on every playthrough — fix first.

### 5.1 onShow multi-application (H13)
- `StoryReader.tsx:854-1000`: add a same-beat-key early return (guard keyed on
  `sceneId::beatId`) so the effect body runs once per beat; remove
  `player.visitLog` from the dep array (derive inside from a ref if needed).
- Test: beat with onShow `changeScore` → score changes exactly once across
  effect re-runs (React Testing Library with StrictMode ON).

### 5.2 applyConsequences stale-ref overwrite (H14)
- `gameStore.ts:1002-1004`: convert to functional updater
  (`setPlayer(prev => compute(prev))`) and keep `playerRef` in sync inside the
  updater or drop it for this path. Test: loadScene + onShow in adjacent
  commits → both updates survive; fired delayed consequences don't resurrect.

### 5.3 Save integrity (H15 + H19)
- Write CURRENT_STORY_ID/EPISODE_ID/SCENE_ID (+ beat) on navigation; restore
  them in hydration; make SAVE & EXIT actually resume mid-episode across
  restarts.
- Add `saveVersion` to persisted player + encounter state; write a migration
  shim (v0→v1 defaults every map/collection: attributes, skills,
  relationships, flags, scores, inventory, completedEpisodes). Corrupt/old
  saves → safe defaults + telemetry, never crash.
- Per-episode snapshot on episode start so replay rolls back flags/scores
  (fixes the stale-state-on-replay half of H15/H20).

### 5.4 Engine data-tolerance pack (H16, H17, H18, M17, M19)
- Flag condition without `value`: default expected to `true`
  (`conditionEvaluator.ts:131`).
- Dangling `nextSceneId`: validate target exists before `transitionTo`; if
  missing, log + fall back to Continue/episode-end rather than soft-lock.
- Episode-delayed consequences: increment `episodesElapsed` in
  `completeEpisode` and add the firing branch; or if the feature is abandoned,
  strip it from generator output + types.
- Legacy encounter path: apply `result.consequences` from `executeChoice`;
  don't double-roll stat checks (use the executeChoice tier).
- Guards: `encounter.outcomes?.[outcome]` at `EncounterView.tsx:1406`;
  `scene.beats ?? []` in `loadScene`; `story.initialState`/`story.npcs`
  defaults in `initializeStory`; `and`/`or` missing `conditions` array.
- **Meta-fix**: add a "hostile story JSON" test corpus for the engine —
  fixtures derived from every malformed-story class the generator has shipped
  (missing outcomes, dangling ids, beats-less scenes, type-less conditions).
  This is the reader-side equivalent of the pipeline defect corpus.

### 5.5 Fiction-first + dev-surface lockdown (H21, M18, 4.x lows)
- `storyEngine.ts:227`: replace `JSON.stringify(anyBeat.content)` fallback
  with `readerSafeBeatFallback`.
- `templateProcessor.ts:222-240`: remove numeric/boolean template expansions
  ({{npc.X.dim}}, {{score.X}}, {{flag.X}}) from the reader path or render
  fiction-safe text; escape `npc.id` before `new RegExp` (or precompile with
  literal matching).
- Gate developer mode behind `__DEV__` or an unlock mechanism; gate
  `window.__QA_FORCE_TIER` out of production bundles; drop the raw skill-key
  flash fallback (use authored label or nothing).

### 5.6 Replay/navigation correctness (H20 + M19 tail)
- Reset `completedEncounters`/`encounterStartedRef` on episode/story change.
- `loadEpisode`: clear `currentScene`/`currentBeatId`; handle missing
  `startingSceneId` explicitly.
- Fix the stat-check deferred-resolution strand (proceedAfterStatCheckRef) —
  resolve or cancel atomically with beat-key changes.
- Move `dc.scenesElapsed`/`dc.fired` mutations out of the setPlayer updater
  (pure updater; compute fired list from the return value).

---

## Phase 6 — De-overfit heuristics (story lexicon extraction)

### 6.1 Per-story lexicon config (H9)
- New `StoryLexicon` artifact (per-treatment config or derived at plan time):
  venue nouns, alias collapses, city/container cues, cue vocabularies
  (threatEncounter etc.), realization-shortcut phrases.
- Migrate consumers: `remediation/storyEventCues.ts`,
  `utils/sceneLocationCues.ts`, `RequiredBeatRealizationValidator.ts:71-131`,
  `EncounterProseIntegrityValidator.ts`. Bite-Me vocabulary becomes the
  Bite-Me lexicon file; defaults are genre-neutral.
- Acceptance: grep for `cismigiu|valcescu|quartz|podcast|dating after dusk|charcoal`
  in `src/ai-agents/{validators,remediation,utils}` returns only lexicon
  files/tests.
- Note the known ceiling: lexical validators can't catch semantic defects —
  where a heuristic drives a BLOCKING or MUTATING decision, either an LLM
  judge confirms (existing fidelity-judge pattern) or the action degrades to
  advisory.

---

## Phase 7 — The live `=1` run + promotion drain + runGraph flip

The single biggest unlock; everything here is already built and waiting.

1. Precondition: Phases 1 & 4 landed (so the run exercises fixed ownership +
   gate accounting); credits available.
2. Run one watched 1-episode live generation with: new gates ON
   (GATE_ENCOUNTER_POV, GATE_RESIDUE_CONSUME, corpus gates),
   `STORYRPG_RUN_GRAPH=1`, and the Phase 1 preflight active.
3. Triage via `.worker-jobs.json` timeline + `99-pipeline-errors.json` +
   quality ledger.
4. On green: flip `runGraphEpisodeLoop` default-ON; delete the legacy
   foundation/episode-loop else-branches (removes the F5 dead duplicate and
   the parity maintenance tax); drain the 17-gate shadow queue in the
   documented promotion order; unblock WS0.2b/0.3b prompt upgrades and the
   QA state_conflict blocker.
5. Then continue monolith decomposition (4.6) on the graph.

---

## Phase 8 — Dead code & drift cleanup (anytime, S)

- Engine/components: `rewindEngine.ts`, `resolutionBalanceSimulator.ts`,
  `relationshipStance.ts`, `ConsequenceToast.tsx`, `StoryBrowser.tsx`,
  vestigial persistence keys (superseded by 5.3), unused
  `effectiveSkillValue`/`skillBonusValue` props (or render them — decide),
  `echoPanel` style, ignored NarrativeText speaker props.
- Pipeline: dead `characterBrief` duplicate (legacy branch — dies with 7.4),
  OpenRouter fusion no-op branch.
- Stale docs/comments: the 4 validator headers claiming default-OFF for
  gates that are ON; encounter "10-min budget"; undici "16 min" note;
  gateDefaults section headers contradicting values.
- Theming: consolidate hardcoded colors in `ReadingScreen.tsx` / ReaderApp
  pause menu onto TERMINAL tokens.

---

## Verification matrix (per phase exit)

| Phase | Proof |
|---|---|
| 0 | traversal test red→green; token-cap regression test; `npm run validate` |
| 1 | double-finalize byte-equality; triple-call-site prompt-presence; new sceneLocationCues.test.ts; golden churn = 0 unexplained |
| 2 | verify:generator in CI; GET-allowlist tests; boundary checker catches a planted dynamic import |
| 3 | per-provider truncation SSE fixtures; worst-case-budget arithmetic test |
| 4 | GATE_* literal sweep green; every-gate-has-callsite green; g23-shape repair-budget test; ratchet under baseline |
| 5 | hostile-story-JSON corpus green; StrictMode double-apply test; cold-start resume e2e (Playwright) |
| 6 | vocabulary grep clean; corpus:check green on both stories |
| 7 | one watched live run: 0 blocking aborts or triaged root causes; runGraph ON |

## Risks / watch-fors

- Phase 1.1 option A touches resume semantics — run the invalidation tests
  (`invalidate:episode`, watermark round-trip) both flag states.
- Phase 4.2's env-read migration changes flag behavior for anyone setting the
  raw env vars — grep run scripts/docs for the 8 names and update.
- Phase 5 typewriter/effect changes are UI-visible — verify with the preview
  workflow, not just unit tests.
- Phase 6 lexicon extraction will churn goldens for Bite-Me — regenerate
  deliberately, review rule-by-rule like the prompt-rule regens.
