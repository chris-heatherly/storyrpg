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

**Remaining in Phase 1 (not yet done):** 1.2 (owned atoms in both prompt
sections — SceneWriter, will touch prompt goldens), 1.3 (non-encounter route
enforcement), 1.5 (sceneLocationCues correctness + dedicated test), 1.6
(register SceneConstructionGate), 1.7 (post-drain diagnostics), 1.8 (stakes
ladder register leak), 1.9 (signature-moment routing), 1.10 (cleanups), 1.11
(commit). Phases 2–8 not started.

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
