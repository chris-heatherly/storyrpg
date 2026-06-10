# Pipeline Phases

Each file in this directory extracts a single phase of `FullStoryPipeline`
into a standalone, independently-testable module that conforms to the
`PipelinePhase<TInput, TResult>` contract from `./index.ts`.

## Why

`FullStoryPipeline.ts` is ~14 kLOC and lives under `@ts-nocheck`. That
compounds every time we edit it: hard to test, hard to type, hard to reason
about phase ordering and state flow. The migration goal is to shrink the
monolith into a thin driver that wires typed phases together.

## Migration order

In priority order (easy leaves first so the driver shrinks quickly before
we touch the hard dependency-heavy phases):

1. [x] `SavingPhase` — wraps `savePipelineOutputs` with timeout + warning
   event contract. Wired in at the end of `runEpisodeForStoryBundle`.
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
5. [ ] `AssemblyPhase` — story assembly + `StructuralValidator.autoFix`
   (Phase 3) + registry coverage gate + asset walk + flag chronology.
6. [x] `VideoPhase` — **wired** (2026-06-09): beat selection (selective
   strategy), per-beat VideoDirector direction + clip generation with
   diagnostics-not-throws error handling, plus `bindGeneratedVideoToStory`.
   Episode-scoped key builders are injected as closures over the brief.
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
10. [ ] `ContentGenerationPhase` — scene + choice + encounter generation
    loop. Hardest phase; candidate for real scene-wave parallelism once
    extracted (see plan Phase 4).
11. [ ] `EpisodeArchitecturePhase` + `BranchAnalysisPhase` — splits the
    current `runStoryArchitect` block.
12. [ ] `CharacterDesignPhase` + `NPCDepthValidationPhase`.

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
