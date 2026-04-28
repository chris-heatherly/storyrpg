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
2. [x] `WorldBuildingPhase` — scaffolded; **NOT wired** yet because the
   monolith still instantiates `WorldBuilder` directly. Follow-up: replace
   inline call in `FullStoryPipeline` with `new WorldBuildingPhase().run(...)`.
3. [ ] `AudioPhase` — extract the `config.narration.preGenerateAudio`
   block that runs right after `SavingPhase`.
4. [ ] `BrowserQAPhase` — extract Playwright QA runner invocation.
5. [ ] `AssemblyPhase` — story assembly + `StructuralValidator.autoFix`
   (Phase 3) + registry coverage gate + asset walk + flag chronology.
6. [ ] `VideoPhase` — video director / video generation block.
7. [ ] `ImagePhase` — master images → scene images → encounter images.
8. [ ] `QAPhase` — `QARunner` + `IntegratedBestPracticesValidator` in
   parallel.
9. [ ] `QuickValidationPhase` — fast validator gate before QA.
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
