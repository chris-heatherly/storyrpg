# Agent Architecture Audit — StoryRPG

**Date:** 2026-05-28
**Scope:** The full agent system — text/narrative agents, the multi-model image
pipeline, the validator suite, and pipeline orchestration.
**Mode:** Read-only assessment. No code was changed.

---

## TL;DR

The agent *decomposition* is sound. Roles are well-separated, there is almost no
true redundancy, and nearly everything is wired in. The problem is not **how many
agents** you have — it's that a handful of them, plus the two pipeline
orchestrators, have grown into **god-objects** that bundle orchestration, prompt
text, domain heuristics, and fallback generators into single files. The system is
**near-optimal in shape, over-weight in a few specific files.**

**Verdict by question:**

| Question | Answer |
|---|---|
| Is the agent structure optimal? | **Structurally yes, physically no.** Right responsibilities, wrong file sizes. |
| Do we need *more* agents? | **No.** One coverage gap (a dedicated dialogue pass) is optional, not needed. |
| Do we need *fewer* agents? | **Marginally.** 1 dead module to delete; a few micro-validators to fold into a dispatcher. The agent *count* is justified. |
| Are any too big? | **Yes — 6 files.** See the "Refactor targets" table. This is the real finding. |

---

## 1. System inventory

Three agent clusters plus orchestration:

| Cluster | Files | Approx. LOC | Health |
|---|---|---|---|
| Text/narrative agents (`agents/`) | 19 agents + `BaseAgent` | ~28,000 | Good shape; 2 god-objects |
| Image agents (`agents/image-team/`) | ~24 agents/validators | ~23,000 | Good shape; 1 god-object + scaffolding debt |
| Validators (`validators/`) | ~44 validator classes | — | **Healthiest cluster.** Clean base, tiered, no dead code |
| Orchestration (`pipeline/`) | `FullStoryPipeline` + `EpisodePipeline` + phases | ~25,000 | **Weakest area.** 21k-line monolith |
| Image service (`services/imageGenerationService.ts`) | 1 file | ~6,500 | God-object under an existing "do not grow" rule |

---

## 2. The real finding: refactor targets (too-big files)

These six files hold the system's architectural risk. Ordered by priority.

| File | LOC | Why it's too big | Recommended split |
|---|---|---|---|
| **`FullStoryPipeline.ts`** | ~21,000 | 12 phases, but only 2 (`SavingPhase`, `WorldBuildingPhase`) extracted. Encounter-tree generation (~2.5k), inline image generation (~6k), multi-episode logic (~1.7k), and Karpathy repair loops (~1.5k) all live inline. The `PipelinePhase`/`PipelineContext` interfaces already exist — the pattern is proven, just not applied. | Extract `EncounterPhase`, `ImageGenerationPhase`, `MultiEpisodePhase`, `AssemblyPhase`, `ContentGenerationPhase` behind the existing `PipelinePhase` contract. |
| **`imageGenerationService.ts`** | ~6,500 | Already under a CLAUDE.md "don't grow, extract instead" rule. Holds a giant provider-router (`generateImageCore`), 500+ lines of provider-specific prompt assembly, an 800-line Gemini narrative-prompt builder, reference handling, Gemini chat-session state, and scattered telemetry. | Extract `promptBuilders/` (per provider), `referenceHandler.ts`, `geminiChatSession.ts`, `imageDiagnostics.ts`. Target ~3,500 LOC. |
| **`ImageAgentTeam.ts`** | ~4,800 | The image orchestrator does everything inline: storyboard, illustration, identity-consistency gate, diversity/transition/expression/color/lighting validation, ref-sheet + expression-sheet generation, and a 420-line full-QA pipeline. The **four coordinators it would delegate to are already defined as types** (`coordinators/index.ts`) but never implemented. | Implement the 4 coordinators (Planning / Illustration / Consistency / Quality). Reduces the team to a ~1,200-line dispatcher. |
| **`EncounterArchitect.ts`** | ~4,315 | Single biggest narrative agent. ~1,000 lines of hardcoded prompt templates, ~600 lines of deterministic-fallback generator (effectively a second mini-generator), and three distinct LLM call patterns (lean / lean-retry / reliable) interleaved. | Extract `encounterArchitectPrompts.ts`, `EncounterFallbackGenerator.ts`; collapse the 3 call patterns behind a small strategy. Orchestrator drops to ~300 lines. |
| **`StoryArchitect.ts`** | ~3,793 | Mixes prompt engineering, a validator-retry loop, and structural-repair heuristics in one `execute()`. | Move prompt to `prompts/`; extract the blueprint validator-orchestration loop. |
| **`CharacterReferenceSheetAgent.ts`** | ~2,846 | Two jobs in one: multi-view character *design* and *expression-sheet* generation. | Split design vs. expression generation. |

Secondary (large but more coherent — lower priority): `SeasonPlannerAgent.ts`
(2,189 — extract episode-distribution math), `SceneWriter.ts` (2,344 — extract
voice-consistency helper), `VisualStorytellingValidator.ts` (2,056 — see §5),
`StoryboardAgent.ts` (2,021), `BaseAgent.ts` (1,210 — see §3).

---

## 3. `BaseAgent` — the shared spine (1,210 lines)

Every LLM agent extends `BaseAgent`. It is **doing too much for a base class**,
bundling: multi-provider dispatch (Anthropic/OpenAI/Gemini), a shared circuit
breaker, concurrency semaphores/guardrails, JSON parse+repair+truncation
recovery, prompt-cache construction, token accounting, and an observer hook.

This is *foundationally correct* — centralizing retries, guardrails, and JSON
repair is exactly why the agents stay thin — but it's a refactor candidate:
extract `LLMDispatcher`, `JSONRepairEngine`, and `GuardrailManager` as
composed collaborators, leaving `BaseAgent` at ~300 lines. **Lower priority than
the §2 files** because it's stable and well-tested; touch it last.

---

## 4. Text/narrative agents — redundancy check

I specifically looked for overlapping responsibilities. **There is essentially none.**
The agents form a clean dependency chain:

```
SourceMaterialAnalyzer → SeasonPlannerAgent → StoryArchitect (per-episode)
  → WorldBuilder + CharacterDesigner → SceneWriter + ChoiceAuthor + EncounterArchitect
  → BranchManager / ThreadPlanner / TwistArchitect / CharacterArcTracker (planning)
  → SceneCritic (optional rewrite) → QAAgents
```

Pairs that *look* redundant but aren't:

- **StoryArchitect vs SeasonPlanner vs SourceMaterialAnalyzer** — three altitudes
  (source-text scoping → season sequencing → per-episode blueprint). Distinct.
- **ThreadPlanner vs TwistArchitect vs CharacterArcTracker** — these are small
  (191/226/254 LOC) but each pulls weight: information plant/payoff vs. one big
  reversal per episode vs. character identity deltas. **Don't merge** — merging
  would re-create a god-object and they're cleanly testable as-is.
- **SceneWriter vs SceneCritic** — author vs. optional surgical-rewrite pass. Fine.

**Notes, not problems:**
- `QAAgents.ts` (1,149 LOC) packs three independent agents (ContinuityChecker,
  VoiceValidator, StakesAnalyzer) into one file. Cosmetic — split for clarity.
- QA agents correctly use a **decorrelated model** (`config.agents.qaRunner`,
  temp 0.3) so the author model isn't grading its own homework. Good design.
- Coverage gap (optional): dialogue/voice synthesis is inlined into `SceneWriter`,
  which is part of why it's 2,344 lines. A dedicated `DialogueAuthor` is *possible*
  but not warranted at current scope — extract a helper instead.

**Wiring:** all 19 narrative agents are invoked by the pipeline. No dead text agents.

---

## 5. Image pipeline — the multi-model layer

### Orchestration
`ImageAgentTeam` is the orchestrator (not a thin facade — see §2). It dispatches
to planning/illustration agents, then runs generated images through a validator
gauntlet, then calls `imageGenerationService.generateImage()`, which routes to a
provider adapter.

### Provider/model matrix (the "multi-model" part — this is a genuine strength)

| Provider | Adapter | Models | Notable | Role |
|---|---|---|---|---|
| Gemini ("nano-banana") | `GeminiAdapter` | 2.5-flash-image, 3-pro-image, 3.1-flash-image | 10 inline refs, multi-turn chat continuity | **Default** |
| Atlas Cloud | `AtlasCloudAdapter` | Flux Dev / Kontext, gpt-image-2 | 16 URL refs, seeds, batch, LoRA (5-slot) | Ref sheets, LoRA paths |
| Midjourney | `MidApiAdapter` | MJ v6 | `--cref`/`--sref` tokens | Encounter images |
| Stable Diffusion | `StableDiffusionProviderAdapter` | SD3/SDXL | Self-hosted, LoRA training | LoRA primary |
| DALL-E | (gpt-image) | gpt-image-2 | safety-retry path | Fallback/test |
| Placeholder | `PlaceholderAdapter` | — | stub | Dev/disabled |

Selection is layered and well-factored: `providerCapabilities` (transport facts) +
`providerPolicy` (health/quarantine after 3 failures) + `referenceStrategy`
(content policy). This separation is clean — keep it.

LLM-reasoning agents (planning, prompt composition, judging) are correctly
separated from the image-gen call layer.

### Validators — not redundant, but over-fragmented at the edges
The 9 visual validators (Composition, PoseDiversity, Transition, Expression,
BodyLanguage, LightingColor, ConsistencyScorer, VisualStorytelling, +
VisualQualityJudge) each check a distinct concern — **not redundant** — with one
exception: **`VisualStorytellingValidator` (2,056 LOC)** overlaps with the
narrower validators (it re-checks transitions, expressions, shot variety). Scope
it to macro-only (pacing/rhythm/sequence) and let the dedicated validators own
the micro checks.

### Scaffolding / dead code
- **`VisualQualityJudge`** (170 LOC): intended unified dispatcher for the 9
  validators — has tests but **is not wired into `ImageAgentTeam`**; validators
  are still called individually. Either finish wiring it or remove it.
- **`VisualNarrativeSystem`** (734 LOC): **genuinely dead** — zero non-self,
  non-test references. Safe-delete candidate (verify the `index.ts` re-export
  isn't part of a public API first).
- Previously suspected-dead but actually wired (keep): `CinematicBeatAnalyzer`
  (used by `shotSequencePlanner`, `beatPromptBuilder`, `imageQaConfig`),
  `CharacterActionLibrary` (used by `ImageAgentTeam`), `VideoDirectorAgent`
  (used by `FullStoryPipeline`'s video phase).

### Character-consistency machinery
Spread across `image-team/` (RefSheetAgent, LoraTrainingAgent, ConsistencyScorer),
`images/` (referencePackBuilder, loraRegistry, styleAnchorGate,
CharacterStateTracker, anchorPrompts), and `services/`. It is **functionally
coherent** (design → state-tracking → optional LoRA → generation-with-refs →
post-gen drift gate) but **fragmented by location**. Not urgent; co-locate
opportunistically.

---

## 6. Validators cluster — the model to copy

This is the healthiest part of the system and a template for the rest:

- **`BaseValidator`** is tiny and clean (`ValidationResult` + `ValidationIssue` +
  two helpers). No bloat.
- **Tiered**: blocking (`FinalStoryContractValidator`), advisory (~33),
  autofix (`CallbackOpportunitiesValidator`, `StructuralValidator`). Strict mode
  escalates advisory → blocking.
- **Staged**: ~38 validators dispatched across season / architecture / phase /
  quick / full / diagnostic / final stages.
- **No dead code** — every validator has a call site.
- **Cost-controlled**: only ~5 call an LLM (Stakes, FiveFactor, Cliffhanger,
  TreatmentFidelity, Pixar); the rest are deterministic.

Minor adjacency: `StakesTriangleValidator` and `FiveFactorValidator` both judge
choice quality (presentation vs. impact) — complementary, leave as-is.

---

## 7. Orchestration pattern

Coordination is a **centralized monolith** (`FullStoryPipeline.generate()`), not
a registry/DI/event-driven design. Agents are hardcoded constructor fields;
`events.ts` is one-way emit (progress/telemetry), not pub-sub; checkpointing is
manual. This is acceptable for a linear generation pipeline — **do not
over-engineer toward a DAG/registry**. The single high-value move is finishing
the **phase extraction** the codebase already started, so `FullStoryPipeline`
becomes a phase sequencer rather than a 21k-line implementation.

---

## 8. Recommendations (priority order)

1. **Decompose `FullStoryPipeline.ts`** into phase modules behind the existing
   `PipelinePhase` contract (Encounter, ImageGeneration, MultiEpisode, Assembly,
   ContentGeneration). Highest leverage — it's the biggest file and the pattern
   already exists.
2. **Continue `imageGenerationService.ts` extraction** (prompt builders, ref
   handler, Gemini session, diagnostics) — it's already under a no-grow rule.
3. **Implement the 4 image coordinators** to shrink `ImageAgentTeam` to a dispatcher.
4. **Split `EncounterArchitect`** — extract prompts + fallback generator.
5. **Scope down `VisualStorytellingValidator`** to macro-only; wire or delete
   `VisualQualityJudge`.
6. **Delete `VisualNarrativeSystem`** (dead, 734 LOC) after confirming no public re-export.
7. **Lower priority / cosmetic:** extract prompt text from `StoryArchitect`,
   `SceneWriter`, `SeasonPlannerAgent` into a `prompts/` dir; decompose
   `BaseAgent` collaborators; split `QAAgents.ts` into three files.
8. **Doc hygiene:** `CLAUDE.md` references `docs/PROJECT_AUDIT_2026-05-28.md`,
   which **does not exist**. Either restore it or fix the pointer.

**What NOT to do:** don't add agents, don't merge the small planning agents
(ThreadPlanner/TwistArchitect/CharacterArcTracker), and don't replace the linear
pipeline with a registry/DAG. The decomposition is right; the work is extraction,
not redesign.
