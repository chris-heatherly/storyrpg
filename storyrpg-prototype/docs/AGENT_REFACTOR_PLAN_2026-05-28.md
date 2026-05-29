# Agent Architecture Refactor Plan — StoryRPG

**Date:** 2026-05-28
**Companion to:** [`AGENT_ARCHITECTURE_AUDIT_2026-05-28.md`](./AGENT_ARCHITECTURE_AUDIT_2026-05-28.md)
**Status:** Plan only — nothing in here has been executed.

---

## Guiding principles

1. **Extraction, not redesign.** Every step preserves behavior. We move code; we
   do not rewrite logic or change agent contracts. The agent decomposition is
   already right (see audit §1–§7).
2. **Safe-first ordering.** Deletions of dead code and pure mechanical moves go
   first; behavior-sensitive orchestrator surgery goes last.
3. **Green gate every step.** Each step is independently shippable and must pass
   the full guardrail suite before the next begins (see "Definition of done").
4. **No new abstractions until forced.** We finish patterns the codebase already
   started (`PipelinePhase`/`PipelineContext`, the image `coordinators/` types)
   rather than inventing registries, DI containers, or a DAG scheduler.

### Definition of done (per step)
Run from `storyrpg-prototype/`:
- `npm run typecheck`
- `npm run lint` (must respect the `--max-warnings` ratchet)
- `npm run test:coverage`
- `npm run check:reader-boundary` (and `npm run verify:reader` if a reader path is touched)
- Monolith ratchet must **drop or hold**, never rise.
- For orchestrator/agent extractions: a **golden-output diff** on a fixture story
  run (see "Safety net" below) must show no semantic change.

### Safety net to establish BEFORE Phase 2+
Behavior-sensitive steps need a regression oracle. Before touching
`FullStoryPipeline`, `ImageAgentTeam`, or `EncounterArchitect`:
- Capture a **golden run**: generate a small fixture story end-to-end and snapshot
  the resulting `Story` JSON + image manifest + `99-pipeline-errors.json`.
- Wire a cheap diff check so each extraction can be compared against the golden
  output. (The pipeline already emits per-run diagnostics under `generated-stories/`.)
- If no such fixture harness exists yet, **building it is Phase 0, step 0.**

---

## Phase 0 — Safe deletions & cosmetic moves (low risk, do first)

No behavior change; builds momentum and shrinks surface area.

| # | Action | Risk | Notes |
|---|---|---|---|
| 0.0 | Stand up the golden-run fixture + diff harness (safety net above). | Low | Prerequisite for Phases 2–5. |
| 0.1 | **Delete `VisualNarrativeSystem.ts`** (734 LOC, zero non-self/non-test refs). | Low | First confirm `image-team` `index.ts` / `agents/index.ts` don't re-export it as public API. Remove its test too. |
| 0.2 | **Resolve `VisualQualityJudge`**: either wire it into `ImageAgentTeam` as the unified validator dispatcher, or delete it (170 LOC + tests). Decide now; default to **delete** unless §3 (Phase 3) will use it. | Low | Currently has tests but no production call site. |
| 0.3 | **Fix the doc pointer:** `CLAUDE.md` references `docs/PROJECT_AUDIT_2026-05-28.md`, which does not exist. Point it at the real audit doc or restore the missing file. | None | Pure docs. |
| 0.4 | **Split `QAAgents.ts`** (1,149 LOC) into `ContinuityChecker.ts`, `VoiceValidator.ts`, `StakesAnalyzer.ts`; keep a barrel re-export so imports don't break. | Low | Mechanical move; index re-export preserves the public API in `agents/index.ts`. |

**Exit criteria:** dead code gone, doc pointer fixed, QA agents split, golden
harness in place. Full gate green.

---

## Phase 1 — Prompt-text extraction (low risk, high LOC payoff)

Move large hardcoded prompt strings out of agents into a `prompts/` module. Pure
string relocation — the agent calls the same builder, the text just lives
elsewhere. This alone reclaims thousands of lines from the worst offenders.

| # | Action | Source → target | ~LOC moved |
|---|---|---|---|
| 1.1 | Extract EncounterArchitect prompt templates | `EncounterArchitect.ts` → `prompts/encounterArchitectPrompts.ts` | ~1,000 |
| 1.2 | Extract StoryArchitect prompt | `StoryArchitect.ts` → `prompts/storyArchitectPrompts.ts` | ~1,000 |
| 1.3 | Extract SceneWriter prompt | `SceneWriter.ts` → `prompts/sceneWriterPrompts.ts` | ~400 |
| 1.4 | Extract SeasonPlanner prompt | `SeasonPlannerAgent.ts` → `prompts/seasonPlannerPrompts.ts` | ~800 |
| 1.5 | Extract Gemini narrative-prompt builder | `imageGenerationService.ts` → `images/promptBuilders/geminiNarrativePrompt.ts` | ~800 |

**Why low-risk:** no control-flow change. The golden diff should be byte-identical
on output. **Why now:** it de-risks Phases 4–5 by making those files readable first.

**Exit criteria:** prompt text centralized; the five files shrink materially;
golden diff clean.

---

## Phase 2 — `imageGenerationService.ts` decomposition (medium risk)

Already under a CLAUDE.md "do not grow, extract instead" rule, so this directly
serves an existing mandate. Target: ~6,500 → ~3,500 LOC.

| # | Action | Target module |
|---|---|---|
| 2.1 | Extract provider-specific prompt assembly (Atlas/Midjourney/OpenAI; Gemini done in 1.5) | `images/promptBuilders/` |
| 2.2 | Extract reference handling (collect/filter/upload/URL-prep) | `images/referenceHandler.ts` |
| 2.3 | Extract Gemini multi-turn chat-session state | `services/geminiChatSession.ts` |
| 2.4 | Extract telemetry / `EncounterImageDiagnostic` builders | `services/imageDiagnostics.ts` |
| 2.5 | Slim `generateImageCore` to early-delegate to adapters (router becomes thin) | in place |

**Risk:** medium — touches the live image path. Mitigate with the golden image
manifest diff and provider-by-provider verification (Gemini default path first).

**Exit criteria:** service under ~3,500 LOC, monolith ratchet drops, no image
output regression on the golden run.

---

## Phase 3 — `ImageAgentTeam.ts` coordinators (medium risk)

The four coordinators are **already defined as types** in
`image-team/coordinators/index.ts` — implement them. Target: ~4,800 → ~1,200 LOC
dispatcher.

| # | Action |
|---|---|
| 3.1 | Implement `ImagePlanningCoordinator` (StoryboardAgent, ColorScriptAgent, CinematicBeatAnalyzer). |
| 3.2 | Implement `ImageIllustrationCoordinator` (VisualIllustratorAgent, EncounterImageAgent, expression-sheet generation loop). |
| 3.3 | Implement `ImageConsistencyCoordinator` (ConsistencyScorerAgent, identity-regeneration gate, ref-sheet cache). |
| 3.4 | Implement `ImageQualityCoordinator` (the validator gauntlet; fold in `VisualQualityJudge` here if Phase 0.2 chose "wire" not "delete"). |
| 3.5 | Reduce `ImageAgentTeam` to a request-type dispatcher over the 4 coordinators. |
| 3.6 | **Scope down `VisualStorytellingValidator`** (2,056 LOC) to macro-only (pacing/rhythm/sequence); let the dedicated micro-validators own transitions/expressions/variety. |

**Risk:** medium — moves orchestration of the validator gauntlet. State (caches,
regeneration budgets) must move intact. Golden image-QA diff is the oracle.

**Exit criteria:** team is a thin dispatcher; coordinators own their slices;
`VisualStorytellingValidator` no longer double-checks micro concerns.

---

## Phase 4 — `EncounterArchitect.ts` split (medium risk)

Target: ~4,315 → ~300-line orchestrator.

| # | Action |
|---|---|
| 4.1 | Prompts already extracted in 1.1. |
| 4.2 | Extract the deterministic fallback generator → `EncounterFallbackGenerator.ts` (~600 LOC; it is effectively a second mini-generator). |
| 4.3 | Collapse the three LLM call patterns (lean / lean-retry / reliable) behind one small strategy/helper. |
| 4.4 | Move encounter domain types to `types/` or a sibling module. |

**Risk:** medium — encounter generation has multiple retry paths and a fallback.
Golden run must exercise both the LLM-success and fallback branches.

**Exit criteria:** orchestrator is thin; fallback is independently testable.

---

## Phase 5 — `FullStoryPipeline.ts` phase extraction (highest risk, highest leverage)

The 21k-line monolith. The `PipelinePhase<TInput,TResult>` /
`PipelineContext` contracts already exist and `SavingPhase` + `WorldBuildingPhase`
prove the pattern. Extract the remaining inline phases one at a time, each behind
that contract, each green before the next.

Suggested extraction order (smallest/most-isolated first):

| # | Phase to extract | ~LOC | Why this order |
|---|---|---|---|
| 5.1 | `CharacterDesignPhase` | ~700 | Self-contained, mirrors the already-extracted WorldBuildingPhase. |
| 5.2 | `EpisodeArchitecturePhase` + `BranchAnalysisPhase` | ~900 | Clear inputs/outputs. |
| 5.3 | `ContentGenerationPhase` (SceneWriter/ChoiceAuthor/EncounterArchitect loop) | ~1,700 | Core, but well-bounded. |
| 5.4 | `EncounterTreePhase` (recursive storylet expansion) | ~2,500 | Large, self-contained subsystem. |
| 5.5 | `ImageGenerationPhase` (after Phase 2–3 land) | ~6,000 | Biggest win; depends on a slimmer image layer existing first. |
| 5.6 | `MultiEpisodePhase` (`generateMultipleEpisodes`) | ~1,700 | Currently interleaved with single-episode code — untangle last. |
| 5.7 | `AssemblyPhase` + completeness gates | ~1,200 | Final assembly + `FinalStoryContractValidator`. |

After 5.1–5.7, `FullStoryPipeline.generate()` becomes a **phase sequencer**, not an
implementation.

**Risk:** highest — this is the live generation brain, with checkpointing, resume,
and repair loops woven through. Each sub-step gets its own golden-run diff and a
checkpoint/resume smoke test. **Do not batch these** — one phase per PR.

**Exit criteria:** pipeline is a sequencer; monolith ratchet drops substantially;
golden run + resume test pass at every sub-step.

---

## Phase 6 — Lower-priority cleanup (deferrable)

| # | Action | Notes |
|---|---|---|
| 6.1 | Decompose `BaseAgent` collaborators (`LLMDispatcher`, `JSONRepairEngine`, `GuardrailManager`); leave `BaseAgent` ~300 LOC. | Stable & well-tested — touch last; high blast radius (every agent). |
| 6.2 | Extract SeasonPlanner episode-distribution math → `SeasonPlanningMath.ts`. | After Phase 1. |
| 6.3 | Extract SceneWriter voice-consistency helper. | After Phase 1. |
| 6.4 | Split `CharacterReferenceSheetAgent` (design vs. expression generation). | 2,846 LOC, two jobs. |
| 6.5 | Opportunistically co-locate character-consistency machinery (currently split across `image-team/`, `images/`, `services/`). | Cosmetic; functionally coherent already. |

---

## Sequencing summary & dependencies

```
Phase 0 (deletions + golden harness)  ──┐
Phase 1 (prompt extraction)            ──┤ independent, do early
                                         │
Phase 2 (image service)  ──► Phase 3 (image coordinators) ──► 5.5 (image phase)
Phase 1.1 ──► Phase 4 (encounter split)
Phase 5.1..5.7 (pipeline phases)  ◄── depends on Phase 0 harness; 5.5 depends on 2+3
Phase 6 (BaseAgent etc.)  ── last, highest blast radius
```

**Hard ordering rules:**
- Phase 0.0 (golden harness) before any Phase 2+ work.
- Phase 2 + 3 before 5.5 (don't extract the image phase until the image layer is slim).
- Phase 6.1 (`BaseAgent`) dead last.

---

## Explicit non-goals (do NOT do)

- Do not add new agents (no `DialogueAuthor`, etc.) — extract helpers instead.
- Do not merge the small planning agents (ThreadPlanner / TwistArchitect /
  CharacterArcTracker) — they're cleanly testable and merging recreates a god-object.
- Do not replace the linear pipeline with a registry / DI container / DAG scheduler.
- Do not change any agent's external contract or prompt *semantics* — moves only.
- Do not touch the validator cluster's design — it's the healthiest part of the system.

---

## Rough effort shape (relative, not estimates)

| Phase | Risk | Leverage | Suggested grouping |
|---|---|---|---|
| 0 | Low | Low–Med | 1 PR (or 1 per deletion) |
| 1 | Low | High (LOC) | 1 PR per agent |
| 2 | Med | High | 1 PR per extraction (2.1–2.5) |
| 3 | Med | High | 1 PR per coordinator |
| 4 | Med | Med | 1–2 PRs |
| 5 | High | Highest | **1 PR per sub-phase, no batching** |
| 6 | Low–High | Med | deferrable |
