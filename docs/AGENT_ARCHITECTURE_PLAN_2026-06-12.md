# Agent Architecture Remediation Plan — 2026-06-12

Source: full-architecture evaluation of `src/ai-agents/` (agents, pipeline
orchestration, validators/remediation, BaseAgent infrastructure). The roster
itself is healthy; the debt is in the seams around it. Workstreams are ordered
by leverage. WS0 is being implemented now; the rest are sequenced behind the
already-owed live `=1` validation run.

## Execution status (2026-06-12, same-day)

- **WS0 — DONE.** CharacterArcTracker wired (characterArcPlanning.ts seam,
  default-off, ChoiceAuthor arcTargets + arc_delta diagnostics fed).
- **WS1 slice 1 — DONE.** GATE_AUTHORED_EPISODE_CONFORMANCE +
  GATE_SEVEN_POINT_ANCHOR_CONFORMANCE relocated to plan placement
  (runPlanTimeFidelityChecks fails fast pre-generation; season-final dispatch
  kept as regression net; both policyExceptions retired). Next slice:
  GATE_DESIGN_NOTE_LEAK meta-narration stripping in the scene-prose repair
  handler, then GATE_ENCOUNTER_ANCHOR_CONTENT encounter-regen route.
- **WS2.1 slice 1 — DONE.** Five context builders pure-moved to
  pipeline/contextAssembly.ts behind thin delegators (monolith 9563 → 9436,
  ratchet lowered). Next: canon/callback prompt-block builders, then the
  agent-owned `repair()` entry points (WS2.2).
- **WS4 — BLOCKED on the live `=1` run** (also covers WS0/WS1 exit checks).
- **WS5 slice 1 — DONE.** Truncation shadow counter: BaseAgent
  setTruncationObserver → per-agent `truncatedResponses` in
  09-llm-ledger.json + run warning. Retry-on-truncation waits for the shadow
  counts, per the sequencing rule.
- **WS6 — RESOLVED.** ContinuityChecker documented as second-opinion audit.
  DramaticStructureValidator is NOT vestigial (architecture-stage advisory
  measuring causality/agency/residue; the pressure validators measure a
  different dimension) — keep both. CharacterIntroduction/PropIntroduction
  are complementary by design (prose-walk vs structured-refs; the former's
  header documents why the latter can't catch its classes) — no change.
  StyleArchitect cache persistence REJECTED: the agent is imported by
  browser-side generator UI (useStyleSetup), and environment-guarded fs in
  the Expo bundle isn't worth one saved LLM call per unique style string.
- **WS3 — NOT STARTED** (sequenced last, after WS1/WS2 mature).

## Evaluation summary (what this plan answers)

- **Roster**: ~17 narrative LLM agents + image team. Well-differentiated; no
  meaningful overlap among ThreadPlanner / TwistArchitect / BranchManager.
  One dead agent (CharacterArcTracker — never instantiated; its consumers
  perpetually skip), one redundant-by-design LLM auditor (ContinuityChecker
  overlaps ~10 deterministic validators).
- **The ratio problem**: 88 validators + 40 remediation files policing 17
  generation agents. The system drifted from "write it right" to "fix it
  after". The sceneRealizationGuard fix (40f7bd7) proved the better
  equilibrium: verify at the cheapest placement, feed exact missing elements
  into generation, protect from rewrite passes.
- **Orchestration**: FullStoryPipeline injects ~25 closures into
  ContentGenerationPhase; ChoiceAuthor is called from 5+ repair paths with
  hand-assembled context; agent outputs mutate shared arrays in place.
- **Infrastructure**: BaseAgent is solid (retry/circuit-breaker/caching/
  observer) but has silent-truncation data loss (L4), triplicated provider
  transports, and hardcoded thresholds.
- **Registries**: validatorRegistry + gateRegistry + gateDefaults are
  documentation-plus-tests, not live dispatchers; a new gate touches 5+ files.

---

## WS0 — Wire CharacterArcTracker (IN PROGRESS, this branch)

The agent was fully built (types, prompt, normalization) and never called.
Its three consumers already exist and are starved:

- `ChoiceAuthorInput.arcTargets` (ChoiceAuthor.ts:205) — prompt section is
  built and dormant.
- `narrativeDiagnostics` arc_delta check — perpetually
  "No CharacterArcTracker targets were available" (narrativeDiagnostics.ts:125).
- `ArcDeltaValidator` — never receives targets.

**Design** (mirrors `threadTwistPlanning.ts` exactly — the proven pattern for
adopting a built-but-unwired agent):

1. New seam `pipeline/characterArcPlanning.ts`:
   - Flag: `STORYRPG_CHARACTER_ARC_TRACKING` env / 
     `generation.enableCharacterArcTracking` config. **Default OFF**; env `1`
     forces on, `0` is a kill-switch. Flag-off is byte-identical (agent never
     constructed, prompts unchanged — golden-snapshot enforced).
   - `planEpisodeArcTargets()` — runs the agent once per episode, after the
     blueprint is final and thread/twist planning, before scene prose.
     Fail-open: timeout/throw/empty ⇒ warn and continue without targets.
   - `toChoiceAuthorArcTargets()` — maps `CharacterArcTargets` onto
     ChoiceAuthor's narrower hint shape (signed delta → direction +
     minor/moderate/major magnitude; relationship deltas → per-dimension
     trajectory entries). Capped to keep prompts tight.
   - `simulateEpisodeArcDeltas()` — deterministic, best-effort
     path-independent observation for ArcDeltaValidator: relationship deltas
     from numeric `RelationshipChange` consequences (mean per choice point,
     summed; `affection` ↔ `bond` mapping), identity movement from
     arc-driving `arc:<axis>:<direction>` flags (fixed per-choice-point
     credit). Measures "does the episode OFFER the planned movement", which
     is what plan-time diagnostics can honestly measure.
2. CharacterArcTracker fixes while wiring:
   - Input declared `seasonBible: SeasonBible` — a type the pipeline never
     produces. Replaced with the season plan that exists.
   - The prompt told the LLM relationship targets "must name a real NPC id
     from the character bible" but never included the bible. Add a compact
     NPC roster (id/name/role) to the prompt; filter unknown npcIds in
     `normalizeTargets`.
3. Pipeline wiring: lazy `getCharacterArcTracker()` (flag-off runs never
   instantiate), `runState.season.episodeArcTargets` map (serialized for
   resume, like `episodeTwistPlans`), per-episode diagnostic artifact
   `episode-N-arc-targets.json`, `arcTargets` + simulated deltas fed to
   `runNarrativeDiagnostics`.
4. **Not in v1** (follow-ups): milestones → SceneWriter directives (same
   shape as twist directives); `startingIdentity` from the prior episode's
   simulated end state; promotion of arc_delta from advisory.

**Exit criteria**: all suites green; promptSnapshot goldens byte-identical
with flag off; live `=1` run shows targets authored, ChoiceAuthor emitting
arc-driving consequences, arc_delta reporting instead of skipping.

---

## WS1 — Contracts upstream (highest leverage, do next)

Generalize the sceneRealizationGuard precedent: for every season-final
blocking gate with a repair loop, ask "what is the cheapest placement where
this contract is checkable?" and move the check there, with one
feedback-retry inside generation.

1. Inventory `gateRegistry.ts` season-final blocking gates; classify each as
   scene-time / episode-time / genuinely-final.
2. Candidates in order: signature-device presence (same mechanics as
   required beats — `realizationScoring` already mirrors it), encounter
   anchor content (check at EncounterArchitect output), dangling-payoff /
   flag-contract classes (check at ChoiceAuthor/SceneWriter parse, where the
   callbackHookId canonicalization fix already lives).
3. Contract-on-artifact pattern: the obligation travels ON the content
   object (as `SceneContent.requiredBeatContract` does), so every rewrite
   pass (SceneCritic polish, POV regen, continuity repair) is
   preserve-or-revert by construction.
4. Success metric: count of season-final repair rounds per run trends to ~0;
   final contract becomes a true safety net, not the primary enforcement.

## WS2 — Context assembly + agent-owned repair

1. Extract a **ContextAssembly** service owning "build agent X's input from
   run state": `buildChoiceAuthorNpcs`, `buildCompactWorldContext`,
   `buildEncounterPriorStateContext`, canon/callback prompt blocks. Phases
   depend on it directly; the injected-closure count in
   ContentGenerationPhaseDeps drops accordingly.
2. Give repair-target agents a uniform `repair(content, issues, context)`
   entry (SceneWriter, ChoiceAuthor, EncounterArchitect, SceneCritic), so
   the five ChoiceAuthor repair call sites stop re-assembling context
   ad hoc. New remediation routes then have one obvious shape.
3. Route new repair work through `runGatedRemediation`; leave the four
   legacy hand-written loops in place (accepted regression risk) but freeze
   them — no new loops in that style.

## WS3 — Registry consolidation

Collapse validatorRegistry + gateRegistry + gateDefaults into one
declaration per gate (placement, tier, repair route, rollout default,
dispatch stage) that the dispatch sites actually read, instead of four call
sites hand-picking validators. Keep the drift tests; they become the
migration harness. Target: adding a gate touches 1 file + 1 test.

## WS4 — runGraph next wave (gated on the owed live run)

1. Run the live `=1` parity run; flip `runGraphEpisodeLoop` default ON.
2. Wrap repair loops as journaled graph steps (inputs/outputs, surgical
   invalidation per-scene instead of per-episode) — this is the same work as
   WS2.2 seen from the runner's side.
3. Continue decomposing `generate()`/`generateEpisodeFromOutline` onto the
   graph toward the façade-<500-line goal.

## WS5 — BaseAgent hardening

1. **Truncation policy** (L4): on detected truncation, retry once with a
   reduced-output instruction or fail the call — never silently return a
   parsed-but-lossy object. Audit the few callers that legitimately tolerate
   loss and make them opt in explicitly.
2. Model capability matrix: one table for temperature acceptance, reasoning
   budgets, response_format — replacing the per-method regex/checks.
3. Extract shared "config+messages → provider request" builders to stop the
   three transports drifting.
4. Config knobs for circuit-breaker threshold / idle timeout (env-tunable).

## WS6 — Roster + validator hygiene (small, batched)

- Document ContinuityChecker as a second-opinion LLM audit (or demote it
  behind a debug flag) so it isn't mistaken for the primary continuity gate.
- Resolve DramaticStructureValidator vs EpisodePressureArchitectureValidator
  (the former looks superseded).
- Check CharacterIntroductionValidator / PropIntroductionValidator
  double-firing; scope one to plan-time only.
- Persist the StyleArchitect style-expansion cache across runs.
- Image team: extract shared prompt/validation utilities across the ~20
  agents (dedup pass, no behavior change).

---

## Sequencing & verification

| Order | Workstream | Gate |
|---|---|---|
| now | WS0 CharacterArcTracker wiring | suites green + goldens byte-identical |
| next | WS1 contracts upstream (1–2 gates per slice) | per-gate shadow comparison on g13 corpus replays |
| with WS1 | WS2.1 ContextAssembly (mechanical extraction) | typecheck + goldens |
| after live run | WS4 graph flag ON, then WS2.2/WS4.2 repair-as-steps | golden parity suite |
| anytime | WS5, WS6 | unit tests; truncation policy needs a shadow count first |
| last | WS3 registry collapse | drift tests as migration harness |

Standing rule: every slice lands default-off or byte-identical, proven by
the promptSnapshot/golden suites, and the live `=1` validation run that is
already owed covers WS0 alongside the queued gate promotions.
