# Pipeline Phases

Each file in this directory extracts a single phase of `FullStoryPipeline`
into a standalone, independently-testable module that conforms to the
`PipelinePhase<TInput, TResult>` contract from `./index.ts`.

## Why

`FullStoryPipeline.ts` started at ~23 kLOC under `@ts-nocheck`; it is now
~12 kLOC and fully typed. The migration goal is to shrink the monolith into
a thin driver that wires typed phases together. Beyond this directory, the
non-phase helper clusters live in sibling modules: `../imageSupport.ts`
(defect-retry render, style-bible anchors, LoRA, opening-beat prefetch),
`../pipelineMemory.ts` (Claude-memory persistence), `../runLedger.ts`
(remediation/gate-shadow ledgers), and `../treatmentRefresh.ts`
(treatment/analysis refresh).

## Migration order

In priority order (easy leaves first so the driver shrinks quickly before
we touch the hard dependency-heavy phases):

1. [x] `SavingPhase` — wraps `savePipelineOutputs` with timeout + warning
   event contract. Wired in at the end of `runEpisodeForStoryBundle`.
1b. [x] `RunArtifactPhase` — **wired** (2026-06-19): output-directory
   resume/create + checkpointing, run/story id derivation, and the
   per-episode completion runtime that writes legacy watermarks plus the new
   shadow artifact graph. Both single-episode and multi-episode drivers now
   delegate output setup to this phase; the season loop delegates episode
   completion writes through the returned runtime.
2. [x] `WorldBuildingPhase` — **wired** (2026-06-09): faithful port of
   `runWorldBuilding` (memoryContext, locationIntroductions, withTimeout,
   PipelineError) behind a thin delegating wrapper covering all three call
   sites. `PipelineError` moved to `pipeline/errors.ts` so phases can throw it
   without importing the monolith. Verified prompt-snapshot byte-identical
   (see `FullStoryPipeline.promptSnapshot.test.ts` + `__goldens__/`).
3. [x] `AudioPhase` — **wired** (2026-06-09): the `preGenerateAudio` block
   (voice casting, batch generation, beat binding, diagnostics + manifest,
   the 08-final-story rewrite) plus `bindGeneratedAudioToStory`. Smoke tests
   cover happy path, skip gate, and non-blocking failure.
4. [x] `BrowserQAPhase` — **wired** (2026-06-09): the Playwright multi-path
   QA loop with image remediation, story reassembly (the phase returns the
   possibly-replaced story), and retry budget. Smoke tests cover pass,
   remediate+retest, skip, non-fatal error, and unresolved-issues paths.
5. [x] `AssemblyPhase` — **wired** (2026-06-10): the Phase 6 region —
   assembleStory call + registry asset merge, `StructuralValidator.autoFix`,
   gated craft auto-fix, player-template resolution, the pre-generation
   completeness gate (registry coverage + missing-image walk), asset HTTP
   verification, and the deterministic flag-chronology/quote-recall scans
   (which escalate onto the shared qaReport in place). `assembleStory` /
   `assembleEpisode` stay in the monolith with their multi-episode and
   branch-validation callers, injected as a closure. One documented
   deviation: the completeness walk's encounter-validation branch referenced
   `encounterValidation`/`sceneBlueprint` from runContentGeneration's scope
   (a latent ReferenceError under `@ts-nocheck`) and was dropped — see the
   NOTE in AssemblyPhase.
6. [x] `VideoPhase` — **wired** (2026-06-09): beat selection (selective
   strategy), per-beat VideoDirector direction + clip generation with
   diagnostics-not-throws error handling, plus `bindGeneratedVideoToStory`.
   Episode-scoped key builders are injected as closures over the brief.
6b. [x] `CoverArtPhase` — **wired** (2026-06-10): `generateStoryCoverArt`
   (poster-concept distillation via a low-temperature LLM call with the
   principles-only fallback block, the full movie-poster rendering prompt,
   protagonist/antagonist reference-image attachment, defect-retry render)
   plus the `PosterConcept` types and compositional-structure normalizer.
   A thin delegating wrapper keeps all three call sites (story-only
   generate, image-only draft run, multi-episode cover) unchanged.
   Non-blocking failure semantics preserved exactly.
7. [~] `ImagePhase` — split per the plan: master images → scene images →
   encounter images.
   - [x] `MasterImagePhase` — **wired** (2026-06-09): character reference
     sheets (eligibility incl. D1 supporting promotion, D5/D8 identity
     drift audit/invalidation, anchor-character-first parallelism, vision
     analysis of user reference images, portrait fallback) + location
     master shots. `generateCharacterReferenceSheet` stays publicly
     callable for the monolith's hydrate-or-generate resume paths;
     run-scoped accumulators (locationMasterShots, character references)
     are shared by reference.
   - [x] `SceneImagePhase` — **wired** (2026-06-09): `runEpisodeImageGeneration`
     (color script / pre-warmed promise, style bible, A3 opening-beat
     prefetch, per-scene storyboard planning, the beat loop with chat-session
     continuity + hero visual QA + registry/disk resume, Tier-2/3 scene QA,
     slot repair, orphan reconciliation). Shared helpers stay injected as
     closures; mutable run-scoped state is accessor-backed. One documented
     deviation: the previously-undeclared `imagesDir` in the disk-artifact
     beat-resume check (a latent ReferenceError) is now bound to
     `<outputDirectory>/images/`.
   - [x] `EncounterImagePhase` — **wired** (2026-06-09): `generateEncounterImages`
     (slot manifests for setup/outcome/storylet images, optional storyboard
     planning, the per-encounter loop with provider policy + resume state,
     the choice-tree recursion, the text-artifact QA policy, the
     missing-slot retry pass, storylet outcomes). Shared helpers stay
     injected as closures; `wireEncounterTreeImages` and the provider
     preflight stay in the monolith with their callers (assembly /
     call-site regions).
8. [x] `QAPhase` — **wired** (2026-06-10): the Phase 5 block (QARunner +
   `IntegratedBestPracticesValidator` in parallel, choice-distribution
   checkpoint, the QA-driven targeted repair loop with SceneWriter/
   ChoiceAuthor re-authoring, threshold warning) plus `runQualityAssurance`
   with its incremental-validation skip stubs. `runQualityAssurance` stays
   publicly callable for the multi-episode loop's per-episode QA pass.
   Run-scoped incremental-validation state (incrementalValidator,
   sceneValidationResults, cachedPipelineMemory) is accessor-backed;
   repairs mutate the shared sceneContents/choiceSets arrays in place.
9. [x] `QuickValidationPhase` — **wired** (2026-06-10): the Phase 4.5 fast
   validator gate (`runQuickValidation`), incremental POV/voice escalation
   into blocking categories, the targeted repair pass (ChoiceAuthor
   re-authoring for stakes/five-factor/stat-balance issues, missing
   choice-point generation for choice-density, scoped SceneWriter rewrites
   for POV/voice/skill-surface), one post-repair re-validation, and the
   blocking `ValidationError`. Repairs mutate the shared
   sceneContents/choiceSets arrays in place; sceneValidationResults and
   cachedPipelineMemory are accessor-backed.
10. [x] `ContentGenerationPhase` — **wired** (2026-06-10): the full
    `runContentGeneration` loop (scene-wave ordering, SceneWriter best-of-N,
    ChoiceAuthor with branch fan-out repair + per-target regeneration +
    deterministic branch fallback, EncounterArchitect with incremental
    validation/regeneration, episode plant context, callback crediting,
    thread/twist planning, prevention context, season-canon prompt blocks,
    SceneCritic pass dispatch). Both call sites (generate() and the
    multi-episode generateEpisodeFromOutline) delegate through a thin
    wrapper; run-scoped state is accessor-backed and the four fields the
    phase assigns (incrementalValidator, sceneValidationResults,
    seasonSkillPlan, encounterTelemetry) are wired with setters. In lieu of
    a mocked smoke test, this phase is end-to-end characterized by the
    THREE prompt-snapshot goldens (linear / branching+encounter /
    multi-episode season) which were verified byte-identical across the
    move. Candidate for real scene-wave parallelism now that it is
    extracted (see plan Phase 4).
11. [x] `EpisodeArchitecturePhase` + `BranchAnalysisPhase` — **wired**
    (2026-06-10): `runEpisodeArchitecture` (season-plan directives +
    StoryArchitect input assembly, the bounded branch-repair retry loop,
    the season-budgeted choice-type rebalance, generation-plan scene
    seeding, B0/B1 advisory-vs-blocking craft-warning classification) and
    `runBranchAnalysis` (BranchManager, deterministic topology cross-check,
    I5 shadow diff; advisory — returns null on failure). The generate()-side
    blocks (resume checkpoint + PhaseValidator retry loop) stay in the
    monolith with the resume state; thin delegating wrappers keep all call
    sites unchanged. seasonChoicePlan (written by the architecture phase),
    generationPlan, architectAdvisoryWarnings, cachedPipelineMemory, and
    branchShadowDiffs are accessor-backed.
12. [x] `CharacterDesignPhase` + `NPCDepthValidationPhase` — **wired**
    (2026-06-10): `runCharacterDesign` (CharacterDesigner input assembly +
    protagonist-collision NPC dedup; thin delegating wrapper covers all
    three call sites) and the Phase 2.5 NPC-depth block (cast depth gate,
    the Karpathy character-design retry that adopts an improved bible via
    `Object.assign` onto the shared reference, strict-mode abort / advisory
    checkpoint on the residue). The Phase 2.3 bible structural validation
    (PhaseValidator retry loop) stays in the monolith with the resume state.

Each extraction should:

- Land as a separate commit / sub-PR.
- Never change behavior at extraction time (pure move).
- Remove any `@ts-nocheck` it touches — new phase files **must** type
  cleanly.
- Come with a unit smoke test that mocks the heavy agent calls and
  asserts the event contract and happy-path output.

## Shared context

`PipelineContext` gives every phase access to the instance methods the
monolith previously called directly on `this`:

- `config` — the active `PipelineConfig`.
- `emit(event)` — pipeline event bus.
- `emitPhaseProgress(phase, done, total, source, message?)` — granular
  progress.
- `addCheckpoint(name, data, optional?)` — resumable checkpoints.
- `checkCancellation()` — cancellation gate.

Pass only references the phase actually needs; resist the urge to pass
`this` directly. When a phase truly needs more state (for example the
asset registry or telemetry), add explicit input fields rather than
growing `PipelineContext`.
