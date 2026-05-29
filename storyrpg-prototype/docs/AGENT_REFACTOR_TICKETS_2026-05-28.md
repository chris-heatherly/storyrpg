# Agent Architecture Refactor — Ticket Backlog

**Date:** 2026-05-28
**Companion to:** [`AGENT_REFACTOR_PLAN_2026-05-28.md`](./AGENT_REFACTOR_PLAN_2026-05-28.md) · [`AGENT_ARCHITECTURE_AUDIT_2026-05-28.md`](./AGENT_ARCHITECTURE_AUDIT_2026-05-28.md)
**Status:** Backlog only — no code written. Tickets are ready to groom/import.

---

## Conventions

- **ID:** `REFAC-<phase><n>` (e.g. `REFAC-00`, `REFAC-12`).
- **Size:** S (<½ day) · M (½–2 days) · L (multi-day) · XL (epic — split before starting).
- **Every ticket's Definition of Done includes the standard gate** unless noted:
  `typecheck` + `lint` (ratchet) + `test:coverage` + `check:reader-boundary` +
  monolith ratchet drops-or-holds. Run from `storyrpg-prototype/`.
- **Behavior-sensitive tickets additionally require:** golden-run diff clean
  (depends on `REFAC-00`).
- **One ticket = one PR** unless the ticket says otherwise.

Labels: `refactor`, `safe-delete`, `extraction`, `image`, `pipeline`, `docs`,
`tooling`, `behavior-sensitive`.

---

## Phase 0 — Safe deletions, cosmetics & the safety net

### REFAC-00 · Build the golden-run regression harness  ⭐ blocking prerequisite
- **Size:** L · **Labels:** `tooling`, `behavior-sensitive`
- **Why:** Phases 2–5 claim "extraction preserves behavior." Without an oracle
  that's a hope. This is the gate for all behavior-sensitive work.
- **Scope:**
  - Pick a small deterministic fixture story input (1 episode, few scenes) that
    exercises: world/character/blueprint phases, content generation, at least one
    encounter, and the image path (can stub image gen to `PlaceholderAdapter` to
    avoid provider cost/non-determinism).
  - Run it end-to-end; snapshot the canonical outputs: final `Story` JSON, image
    slot manifest, and `generated-stories/<run>/99-pipeline-errors.json`.
  - Add a diff command that re-runs the fixture and compares against the snapshot,
    flagging semantic deltas (normalize volatile fields: timestamps, run ids, file
    paths, non-deterministic token counts).
  - Document how to refresh the snapshot intentionally (when a change *should*
    alter output).
- **Acceptance criteria:**
  - `npm run <new golden-diff script>` exits 0 on an unchanged tree.
  - Introducing a deliberate behavior change makes it exit non-zero with a readable diff.
  - Volatile fields are normalized so reruns are stable.
  - README/doc note on refresh workflow.
- **Dependencies:** none. **Must land before** REFAC-20+, REFAC-30+, REFAC-40+, REFAC-50+.
- **Open question for grooming:** does a fixture/snapshot harness already exist
  under `fixtures/` or the pipeline tests we can extend rather than build new?

### REFAC-01 · Delete dead `VisualNarrativeSystem`
- **Size:** S · **Labels:** `safe-delete`, `image`
- **Scope:** Remove `image-team/VisualNarrativeSystem.ts` (~734 LOC) and its test.
- **Acceptance criteria:**
  - First confirm zero remaining references (verified 2026-05-28: 0 non-self,
    non-test refs) **and** that `image-team/index.ts` / `agents/index.ts` do not
    re-export it as public API. If re-exported, remove that export too.
  - Standard gate green; monolith ratchet drops.
- **Dependencies:** none.

### REFAC-02 · Resolve `VisualQualityJudge` (wire or delete)
- **Size:** S–M · **Labels:** `image`, `refactor`
- **Decision required (grooming):** `VisualQualityJudge` (170 LOC) has tests but no
  production call site. Either:
  - **(A) Delete** it + tests now (default), OR
  - **(B) Defer-to-REFAC-34**: keep it and mark it as the dispatcher to be wired in
    Phase 3's `ImageQualityCoordinator`.
- **Acceptance criteria:** decision recorded in the ticket; if delete, gate green
  and no dangling imports; if defer, ticket linked to REFAC-34 and left untouched.
- **Dependencies:** none. Influences REFAC-34.

### REFAC-03 · Fix stale doc pointer in `CLAUDE.md`
- **Size:** S · **Labels:** `docs`
- **Scope:** `CLAUDE.md` references `docs/PROJECT_AUDIT_2026-05-28.md`, which does
  not exist. Repoint to the real audit doc(s) or restore the missing file.
- **Acceptance criteria:** the referenced path resolves; no other doc links to the
  missing file.
- **Dependencies:** none.

### REFAC-04 · Split `QAAgents.ts` into three files
- **Size:** M · **Labels:** `extraction`, `refactor`
- **Scope:** Split the 1,149-LOC file into `ContinuityChecker.ts`,
  `VoiceValidator.ts`, `StakesAnalyzer.ts`. Keep a barrel re-export so
  `agents/index.ts` consumers are unaffected.
- **Acceptance criteria:**
  - Public exports from `agents/index.ts` unchanged (verify import sites compile).
  - No logic change; tests still pass unmodified (or move with their agent).
  - Standard gate green.
- **Dependencies:** none.

---

## Phase 1 — Prompt-text extraction (low risk, high LOC payoff)

> Pattern for all Phase-1 tickets: move the prompt *string/template* into a new
> `prompts/<agent>Prompts.ts`; the agent imports and calls it. **No semantic change
> to the prompt.** Golden diff must be clean (ideally byte-identical output).

### REFAC-10 · Extract EncounterArchitect prompts
- **Size:** M · **Labels:** `extraction`, `behavior-sensitive`
- **Scope:** `EncounterArchitect.ts` → `prompts/encounterArchitectPrompts.ts` (~1,000 LOC).
- **Acceptance:** golden diff clean; `EncounterArchitect.ts` shrinks by ~1k; gate green.
- **Dependencies:** REFAC-00. **Unblocks** REFAC-40 (encounter split).

### REFAC-11 · Extract StoryArchitect prompt
- **Size:** M · **Labels:** `extraction`, `behavior-sensitive`
- **Scope:** `StoryArchitect.ts` → `prompts/storyArchitectPrompts.ts` (~1,000 LOC).
- **Dependencies:** REFAC-00.

### REFAC-12 · Extract SceneWriter prompt
- **Size:** S–M · **Labels:** `extraction`, `behavior-sensitive`
- **Scope:** `SceneWriter.ts` → `prompts/sceneWriterPrompts.ts` (~400 LOC).
- **Dependencies:** REFAC-00.

### REFAC-13 · Extract SeasonPlanner prompt
- **Size:** M · **Labels:** `extraction`, `behavior-sensitive`
- **Scope:** `SeasonPlannerAgent.ts` → `prompts/seasonPlannerPrompts.ts` (~800 LOC).
- **Dependencies:** REFAC-00.

### REFAC-14 · Extract Gemini narrative-prompt builder
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** `imageGenerationService.ts` → `images/promptBuilders/geminiNarrativePrompt.ts` (~800 LOC).
- **Acceptance:** golden image-manifest diff clean on the Gemini default path.
- **Dependencies:** REFAC-00. **Unblocks** REFAC-20.

---

## Phase 2 — `imageGenerationService.ts` decomposition (medium risk)

> Target: ~6,500 → ~3,500 LOC. Serves the existing CLAUDE.md "don't grow" rule.
> Verify provider-by-provider; Gemini default path first.

### REFAC-20 · Extract provider-specific prompt builders (Atlas/Midjourney/OpenAI)
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** Move Atlas/Midjourney/OpenAI prompt assembly into `images/promptBuilders/`
  (Gemini already moved in REFAC-14).
- **Dependencies:** REFAC-00, REFAC-14.

### REFAC-21 · Extract reference handling
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** collect/filter/upload/URL-prep logic → `images/referenceHandler.ts`.
- **Dependencies:** REFAC-00.

### REFAC-22 · Extract Gemini chat-session state
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** multi-turn chat-session continuity state → `services/geminiChatSession.ts`.
- **Acceptance:** scene-to-scene continuity behavior unchanged on golden run.
- **Dependencies:** REFAC-00.

### REFAC-23 · Extract telemetry / diagnostics builders
- **Size:** S–M · **Labels:** `extraction`, `image`
- **Scope:** `EncounterImageDiagnostic` + telemetry assembly → `services/imageDiagnostics.ts`.
- **Dependencies:** REFAC-00.

### REFAC-24 · Slim `generateImageCore` to early adapter delegation
- **Size:** M · **Labels:** `refactor`, `image`, `behavior-sensitive`
- **Scope:** Replace the long provider `if`-chain with thin early delegation to
  registry adapters.
- **Acceptance:** all six provider paths route identically to before; service under ~3,500 LOC.
- **Dependencies:** REFAC-20, REFAC-21, REFAC-23.

---

## Phase 3 — `ImageAgentTeam.ts` coordinators (medium risk)

> The 4 coordinators are already defined as **types** in
> `image-team/coordinators/index.ts`. Implement them; reduce the team to a
> ~1,200-LOC dispatcher.

### REFAC-30 · Implement `ImagePlanningCoordinator`
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** StoryboardAgent, ColorScriptAgent, CinematicBeatAnalyzer move behind it.
- **Dependencies:** REFAC-00. (Independent of Phase 2 but easier after it.)

### REFAC-31 · Implement `ImageIllustrationCoordinator`
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** VisualIllustratorAgent, EncounterImageAgent, expression-sheet loop.
- **Dependencies:** REFAC-00.

### REFAC-32 · Implement `ImageConsistencyCoordinator`
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** ConsistencyScorerAgent, identity-regeneration gate, ref-sheet cache.
  **State (caches, regeneration budgets) must move intact.**
- **Dependencies:** REFAC-00.

### REFAC-33 · Implement `ImageQualityCoordinator`
- **Size:** M · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** The validator gauntlet. If REFAC-02 chose **(B)**, wire
  `VisualQualityJudge` here as the unified dispatcher.
- **Dependencies:** REFAC-00, REFAC-02 (decision).

### REFAC-34 · Reduce `ImageAgentTeam` to a dispatcher
- **Size:** M · **Labels:** `refactor`, `image`, `behavior-sensitive`
- **Scope:** Team delegates by request type to the 4 coordinators; target ~1,200 LOC.
- **Dependencies:** REFAC-30, 31, 32, 33.

### REFAC-35 · Scope down `VisualStorytellingValidator` to macro-only
- **Size:** M · **Labels:** `refactor`, `image`, `behavior-sensitive`
- **Scope:** Remove the micro checks (transitions/expressions/shot-variety) it
  duplicates from dedicated validators; keep pacing/rhythm/sequence. 2,056 LOC → smaller.
- **Acceptance:** no validation coverage lost (the dedicated validators still run
  those checks); golden image-QA diff explained (warnings may shift owner, not disappear).
- **Dependencies:** REFAC-33.

---

## Phase 4 — `EncounterArchitect.ts` split (medium risk)

### REFAC-40 · Extract deterministic fallback generator
- **Size:** M · **Labels:** `extraction`, `behavior-sensitive`
- **Scope:** ~600-LOC fallback generator → `EncounterFallbackGenerator.ts`.
- **Acceptance:** golden run exercises **both** LLM-success and fallback branches; clean.
- **Dependencies:** REFAC-00, REFAC-10.

### REFAC-41 · Collapse the three LLM call patterns behind one strategy
- **Size:** M · **Labels:** `refactor`, `behavior-sensitive`
- **Scope:** lean / lean-retry / reliable patterns unified behind a small helper;
  orchestrator drops toward ~300 LOC. Move encounter domain types to `types/`.
- **Dependencies:** REFAC-40.

---

## Phase 5 — `FullStoryPipeline.ts` phase extraction (highest risk)

> Extract inline phases behind the existing `PipelinePhase`/`PipelineContext`
> contracts (proven by `SavingPhase` + `WorldBuildingPhase`). **One sub-phase per
> PR. No batching.** Each gets its own golden diff + a checkpoint/resume smoke test.

### REFAC-50 · Extract `CharacterDesignPhase`
- **Size:** M · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** ~700 LOC; mirror the existing `WorldBuildingPhase`.
- **Dependencies:** REFAC-00.

### REFAC-51 · Extract `EpisodeArchitecturePhase` + `BranchAnalysisPhase`
- **Size:** M · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** ~900 LOC.
- **Dependencies:** REFAC-50 (sequential to limit churn).

### REFAC-52 · Extract `ContentGenerationPhase`
- **Size:** L · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** SceneWriter/ChoiceAuthor/EncounterArchitect loop (~1,700 LOC).
- **Dependencies:** REFAC-51.

### REFAC-53 · Extract `EncounterTreePhase`
- **Size:** L · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** recursive storylet expansion (~2,500 LOC).
- **Dependencies:** REFAC-52.

### REFAC-54 · Extract `ImageGenerationPhase`
- **Size:** L · **Labels:** `pipeline`, `image`, `extraction`, `behavior-sensitive`
- **Scope:** ~6,000 LOC; the biggest single win.
- **Dependencies:** REFAC-53 **and** Phase 2–3 complete (slim image layer must exist first).

### REFAC-55 · Extract `MultiEpisodePhase`
- **Size:** L · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** `generateMultipleEpisodes` (~1,700 LOC), currently interleaved with
  single-episode code — untangle last.
- **Dependencies:** REFAC-54.

### REFAC-56 · Extract `AssemblyPhase` + completeness gates
- **Size:** M–L · **Labels:** `pipeline`, `extraction`, `behavior-sensitive`
- **Scope:** ~1,200 LOC including `FinalStoryContractValidator` gate.
- **Dependencies:** REFAC-55.

### REFAC-57 · Reduce `FullStoryPipeline.generate()` to a phase sequencer
- **Size:** M · **Labels:** `pipeline`, `refactor`, `behavior-sensitive`
- **Scope:** After 50–56, the method should read as an ordered list of phase calls.
- **Acceptance:** monolith ratchet drops substantially; full golden run + resume test pass.
- **Dependencies:** REFAC-50…56.

---

## Phase 6 — Deferrable cleanup

### REFAC-60 · Decompose `BaseAgent` collaborators
- **Size:** L · **Labels:** `refactor`, `behavior-sensitive`
- **Scope:** Extract `LLMDispatcher`, `JSONRepairEngine`, `GuardrailManager`;
  `BaseAgent` → ~300 LOC. **Highest blast radius (every agent) — do last.**
- **Dependencies:** all prior phases stable. Full golden run required.

### REFAC-61 · Extract SeasonPlanner episode-distribution math
- **Size:** S–M · **Labels:** `extraction` · **Dependencies:** REFAC-13.

### REFAC-62 · Extract SceneWriter voice-consistency helper
- **Size:** S–M · **Labels:** `extraction` · **Dependencies:** REFAC-12.

### REFAC-63 · Split `CharacterReferenceSheetAgent` (design vs. expression)
- **Size:** M–L · **Labels:** `extraction`, `image`, `behavior-sensitive`
- **Scope:** 2,846 LOC, two jobs. **Dependencies:** REFAC-00.

### REFAC-64 · Co-locate character-consistency machinery
- **Size:** M · **Labels:** `refactor`, `image`
- **Scope:** Cosmetic move of files split across `image-team/`, `images/`, `services/`.
  Lowest priority. **Dependencies:** Phase 3 complete.

---

## Dependency graph (quick reference)

```
REFAC-00 ──┬─► REFAC-10 ─► REFAC-40 ─► REFAC-41
           ├─► REFAC-14 ─► REFAC-20 ─┐
           │                         ├─► REFAC-24
           ├─► REFAC-21 ─────────────┤
           ├─► REFAC-23 ─────────────┘
           ├─► REFAC-30,31,32,33 ─► REFAC-34
           │        REFAC-33 ─► REFAC-35
           └─► REFAC-50 ─► 51 ─► 52 ─► 53 ─► 54 ─► 55 ─► 56 ─► 57
                                          ▲
                       (Phase 2+3 done) ──┘
REFAC-01, 03, 04  : independent, no deps
REFAC-02          : independent; influences REFAC-33
REFAC-60          : last, after everything stable
```

## Suggested first sprint
`REFAC-00` (the harness — start immediately), then in parallel the dependency-free
safe wins: `REFAC-01`, `REFAC-03`, `REFAC-04`, and the `REFAC-02` decision.
Phase 1 prompt extractions follow as soon as `REFAC-00` lands.
