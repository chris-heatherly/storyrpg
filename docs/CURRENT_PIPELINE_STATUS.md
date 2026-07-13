# Current Pipeline Status

**Last Updated:** July 13, 2026

This is the short operational status of the codebase as it exists now. It is
intended to answer "what is live?" before older architecture notes or audit
documents are consulted.

For the broader app/proxy/deployment snapshot, read `docs/PROJECT_STATUS.md`
first. This file stays focused on generation and output compatibility.

## Authoritative Path

Story generation is owned by `src/ai-agents/pipeline/FullStoryPipeline.ts`.
The UI talks to `PipelineClient`, the Express proxy starts a worker through
`proxy/workerLifecycle.js`, and the worker streams structured pipeline events
back into the generation job stores.

`EpisodePipeline.ts` and `ParallelStoryPipeline` are no longer present. New
work should use `FullStoryPipeline` and its extracted phase modules.

The app now has two target-specific web entries:

- `apps/reader/ReaderApp.tsx` for public playback.
- `apps/generator/GeneratorApp.tsx` for internal generation and media jobs.

The generator target is the active UI surface for `PipelineClient` and worker
jobs. The reader target must remain isolated from generation modules; that
boundary is enforced by `npm run check:reader-boundary`.

## Current Generation Flow

### Authored-lite treatments (`sourceKind === 'authored_lite'`)

Structural authorship collapses to five stages. ESC is the sole structural
author; later agents compile, realize, or enforce — they do not invent scene
order or topology.

1. **Parse + ESC** — `treatmentExtraction` / `SourceMaterialAnalyzer` →
   `compileEpisodeSpine` → `seasonScenePlanBuilder` projection.
   `SeasonPlannerAgent` may only overlay metadata (budgets/flags); it must not
   call `authorScenePlanLLM` or mutate scene id/order/`spineUnitId`.
2. **Facts** — `WorldBuilder` + `CharacterDesigner` (world/character bibles).
3. **Realize** — `StoryArchitect` fill-slots only (ESC unit text → turnContracts);
   `BranchManager` deterministic skeleton (LLM annotation skipped unless
   `STORYRPG_BRANCH_ANNOTATION=1` / branch shadow mode);
   `SceneWriter` / `ChoiceAuthor` / `EncounterArchitect` with ESC-compiled
   thread/twist/arc directives (Thread/Twist/Arc LLMs skipped unless
   `STORYRPG_THREAD_TWIST_PLANNING=1` / `STORYRPG_CHARACTER_ARC_TRACKING=1`).
4. **Enforce** — plan-time fidelity + `EpisodeSpineContractValidator`; final
   text contract with prose/field repair only. Structural classes
   (`blueprint_rebalance` / `episode_replan`) fail closed toward architecture
   retry or ESC/`rebuildTreatmentSeasonScenePlan` refresh.
5. **Media** — post-story images/video/audio after the text contract passes.

Skip telemetry (debug events): `thread_twist_skipped_authored_lite`,
`character_arc_skipped_authored_lite`, `branch_annotation_skipped_authored_lite`.

Cognee remains advisory-only: index compiled ESC/ledger facts, not competing
LLM plans.

Authored generation is admitted through `GenerationManifest` preflight. The
manifest pins `sourceKind`, requested episodes, source-analysis hash,
season-plan id/hash, graph hash, and compiler version using the JSON wire
representation shared by the browser and worker. Generator state may recover a
matching saved plan, but UI, worker, service, and pipeline boundaries fail
closed before provider calls when the plan, graph, planned scenes, or
`EpisodeEventPlan` projection is missing or has drifted. `StoryArchitect`
receives the explicit source kind and cannot infer invent mode from a missing
optional plan field.

### Non-authored-lite / invent-mode

1. Optional source analysis via `SourceMaterialAnalyzer`.
2. Optional season planning via `SeasonPlannerAgent` (may LLM-upgrade scene
   plans when not treatment-bound) and `StoryCircleCoverageValidator`.
3. Shared foundation: `WorldBuilder`, `CharacterDesigner`, `NPCDepthValidator`,
   and `PhaseValidator`.
4. Per-episode planning and content: `StoryArchitect` (invent-mode allowed),
   `BranchManager`, `SceneWriter`, `ChoiceAuthor`, and `EncounterArchitect`.
5. Optional narrative scaffolding: `ThreadPlanner`, `TwistArchitect`,
   `CharacterArcTracker` (when generation flags enable them), plus
   `CallbackLedger` and optional `SceneCritic`.
6. Mechanical story metadata: story verbs, affordance sources, witness
   reactions, failure residue, branch-shadow diagnostics, and visualizer
   diagnostics where enabled.
7. Validation: incremental per-scene checks, quick best-practices checks,
   LLM QA, branch/divergence checks, scene graph checks, setup/payoff checks,
   twist checks, arc-delta checks, mechanical storytelling checks, sequence
   continuity audits, and treatment-fidelity checks.
8. Post-story media: after story authoring, per-episode QA, and episode
   failure gates complete, the pipeline runs master reference visuals,
   storyboard-v2 beat imagery, `ImageAgentTeam`, encounter imagery,
   provider-aware reference packs, structured art-style profiles,
   preapproved style anchors, optional Stable-Diffusion LoRA training,
   optional video generation, and optional ElevenLabs narration.
9. Finalization: runtime `Story` assembly from the story-first episodes plus
   post-story media assets, `SavingPhase`,
   `pipelineOutputWriter`, story codec packaging, asset HTTP validation,
   optional Playwright multi-path QA, and image remediation/re-save when
   possible.

`SavingPhase` and `WorldBuildingPhase` are wired active paths under
`src/ai-agents/pipeline/phases/`. Continue phase extraction as
behavior-preserving migrations.

## Canonical Narrative Realization Contract

`NarrativeContractGraph` and `EpisodeEventPlan` version 8 compile premise,
event, relationship-pacing, and route obligations into executable
`NarrativeRealizationTask` records. A task has one owner (`SceneWriter`,
`ChoiceAuthor`, or `EncounterArchitect`), one discriminated evidence `target`,
typed evidence atoms, an explicit verification authority, severity, and a repair route. The target is the only
active representation of surface and route placement; the former
`requiredSurface` + `routePolicy` + top-level `outcomeTier` combination is
accepted only by the checkpoint migration boundary.

Compiler v23 derives non-ESC event identity from stable source text rather than
scene IDs. After scene identity settles, `SemanticContractCompilerAgent`
compiles every depiction event and authored opening premise into a persisted,
versioned `AuthoredEventSemanticIR`. Event propositions cite exact authored
source spans and declare semantic criteria, role, participants, prerequisite
propositions, and staged versus referenced locations. Premise propositions are
complete subject-predicate claims with an explicit evidence threshold; isolated
words and n-grams are invalid. Premise contracts are load-balanced across the
first two episode scenes, and the graph rejects semantically compiled plans that
exceed the per-scene blocking-premise claim budget. Deterministic validation
enforces complete event and premise coverage, exact source provenance, stable
IDs, forward-only prerequisites, known locations, policy version, and source
hash. It does not infer the meaning of the authored text.

The previous regex event atomizer now runs only to build a transient bootstrap
graph or migrate legacy artifacts. Its inferred clause boundaries, roles,
participants, and semantic alternatives are never authoritative in a new
production plan. `runStoryAnalysis` recompiles the scene plan from the LLM IR
before returning either a fresh or resumed plan, and episode generation fails
at preflight when depiction events lack that persisted IR. The graph artifact
stores the IR and includes its source identity in the graph hash.

Required beats that describe independent authored
events retain separate event IDs instead of being folded into a scene's primary
turn. Location evidence distinguishes staged action from referenced destinations;
the compiler can rebind an independent event to a compatible same-episode scene
or repair a dedicated ESC shell from its bound event without changing chronology.
Abstract subordinate pressure such as `After testing X, Y happens` compiles as a
typed behavioral prerequisite on event Y rather than a standalone depiction
event. If obligation rebinding moves the depiction beat, the scene-plan builder
restores the ESC unit's behavioral intents to the unique depiction owner before
relationship-milestone validation; scene position cannot silently detach an
earning prerequisite from its canonical event. Social-test evidence includes named-target and second-person question,
challenge, and probing realizations so fiction-first prose is not forced to use
the treatment's synopsis register.
Persisted abstract `Testing X` units migrate into their dependent event;
concrete tests with an actor and mechanism remain independent events. Static
identity facts remain provenance/evidence but do not become chronological action
atoms or force planning-register language into reader prose. Interpretive Story
Circle summaries now fold into the canonical events they describe instead of
creating duplicate depiction ownership on their incidental projection scene.
Each atom declares exactly one authority: `structured` for canonical fields and
state, `literal` for exact names, labels, and aliases, or `semantic_judge` for
prose meaning. Deterministic matching never clears or blocks a
`semantic_judge` atom. The low-temperature QA-model judge receives only
addressable sentence-level reader-facing excerpts already restricted to the
task's owner surface and route, returns a categorical verdict with excerpt IDs,
and deterministic code derives diagnostic quotes from those cited spans. Judge
calls use focused micro-batches of at most three claims; a failed batch splits
to individual claims so one malformed verdict cannot erase unrelated decisions.
A negative verdict requires a second sample. Disagreement or persistent
uncertainty invokes a focused claim-level adjudication pass; a categorical
adjudication resolves prior indecision, while unresolved disagreement produces
`semantic_validation_inconclusive`. Task thresholds are evaluated before
uncertainty is promoted, so an unused uncertain alternative cannot block a
contract whose required evidence count is already satisfied. Provider unavailability,
malformed structured output, and judge-policy errors produce typed validation
infrastructure outcomes, never content-missing verdicts. Those failures retry
the judge against the same immutable candidate and do not spend an authored
repair attempt. Confirmed meaning misses retain the task's existing repair
route.

Each event atom now carries an optional producer stage and temporal slot. When a
route-invariant relationship or state transition happens after a player-facing
choice, the compiler partitions the event into a pre-choice `SceneWriter` task
and an all-outcome `ChoiceAuthor` resolution task linked by explicit task and
atom prerequisites. `SceneWriter` receives the pressure and decision boundary;
`ChoiceAuthor` authors one shared fiction-first resolution and the pipeline
projects that authored passage into every option's success, partial, and failure
outcome. No deterministic system invents the payoff. Generic group names are
excluded from participant identity extraction. Equivalent repeated projections
coalesce idempotently; scene-projected task and atom IDs include their owner
scene, while conflicting ID reuse remains blocking. Task compilation also
rejects dangling evidence-group atoms, backward producer dependencies, and
unreachable outcome surfaces. All scene-owned task families now resolve their
producer, repair handler, artifact path, temporal slot, and evidence surfaces
through one scene-aware execution-target function. Compilation fails with
`owner_stage_unreachable` when a blocking task targets a missing scene, assigns
SceneWriter to an encounter, assigns EncounterArchitect to a standard scene, or
names a surface its producer cannot author. Specialized evidence
requirements are additive to the canonical atomized owner task and can no
longer suppress it through compile order.

Transition contracts are typed as opening orientation, continuous action, or
state handoff. Location, time, movement, and state evidence remain separate
requirements rather than a flattened list of literal strings. Encounters expose
an `encounter_entry` surface containing only their description and opening beat,
so a late callback cannot satisfy entry chronology. Location identity matching
is diacritic-insensitive and ignores generic place-type variation while still
requiring the distinctive location identity; lowering the global semantic
threshold is not used as a reliability fix.

Season graph validity remains global and blocking for event identity, chronology,
canon, and cross-episode dependencies. Detailed scene executability is enforced
when an episode enters the requested generation frontier. A later episode may
therefore retain an invalid diagnostic projection without blocking an earlier
episode, but it cannot itself generate until its projection passes.

The content phase validates each task at its owning stage and supplies bounded,
fingerprint-targeted feedback retries before accepting or checkpointing the
artifact. Owner-stage semantic uncertainty remains inside that bounded repair
loop instead of terminating the job before the owning agent can clarify its
prose; unresolved uncertainty at final regression remains blocking.
SceneWriter-owned semantic misses use an LLM-authored
`SceneSemanticPatch` against the immutable baseline: at most two adjacent beat
texts or one transition may be replaced or inserted, while deterministic code
checks the base hash and applies the returned text operations. The loop accepts
at most two authored candidates and bounds provider/patch calls separately.
The active content path no longer inserts deterministic required-moment prose.
Repair candidates are immutable snapshots and are replay-validated;
non-identical findings for the same snapshot fail with a typed
`validator_snapshot_mismatch` error. A candidate is adopted only when it clears
the targeted fingerprint without introducing another blocker. Unresolved SceneWriter-owned tasks abort
before ChoiceAuthor, callback accounting, completion status, or checkpointing.
Failed candidates and full semantic receipts are persisted before failure for
deterministic replay. Typed failure code, owner stage, retry class, issue codes,
artifact references, and repair target survive the episode, worker, and proxy
boundaries. Semantic verdicts are cached by task, atom, scoped evidence, judge
policy, provider, model, and schema. Positive receipts may be reused after
unrelated prose changes only when every cited excerpt still exists with the
same text hash; inconclusive and infrastructure-failure verdicts are never
cached. Every initial or regenerated choice set passes one transactional
prepare/validate/commit path: canonical state setters, information markers,
residue, and route fan-out are applied to a clone; owner and producer gates run
on that exact clone; only a valid candidate replaces the committed choice set
and its within-episode plant projection. Route evidence
is evaluated per playable outcome and cannot be borrowed across routes or from
an undeclared surface. `NarrativeContractValidator` repeats deterministic
contract checks after late story mutations, while the asynchronous final
contract reuses or refreshes hash-bound semantic receipts as the meaning
regression net. The owner-stage fingerprint is preserved through final-contract
repair accounting. Each owner evaluation emits a receipt containing the task
IDs, owner stage, candidate hash, finding fingerprints, judge identity,
categorical verdicts, evidence references, response hash, and sample count. The
per-scene pass is a regression net and must match
the union of those receipts exactly; missing owner artifacts fail as
`owner_stage_not_executed`, while divergent fingerprints fail as
`owner_stage_coverage_mismatch` without a blind LLM retry.

Three older event heuristics (viral payoff, exact codename, and all-route threat
checks) remain only for persisted graphs that have no compiled realization task.
They do not execute alongside a version-8 task and are tracked for deletion in
`docs/LEGACY_REMOVAL_REGISTRY.md`.

Validation ownership now has two explicit levels:

- Per-story authored obligations are owned exclusively by
  `NarrativeContractGraph` / `NarrativeRealizationTask`. Static validator policy
  must not redefine a task's owner, evidence target, repair handler, or
  fingerprint.
- Cross-cutting structural/runtime/package rules remain in the metadata-only
  `validatorRegistry.ts` and `gateRegistry.ts`. Registry rows have stable policy
  ids, while stage-local orchestration remains the executable dispatcher.

`ValidatorExecutionRecord` joins those levels in runtime evidence: records can
carry policy id, task/contract ownership, execution mode, artifact references,
and repair disposition without scheduling validators a second time. Episode
`validation-report` artifacts persist owner-stage plus best-practices execution
records, and final-contract reports persist the final aggregate plus fidelity
regression records.

Operational inspection commands:

- `npm run validation:audit` checks gate/validator registry drift and policy-id
  uniqueness.
- `npm run validation:explain -- --validator <id>` explains static policy.
- `npm run validation:explain -- --run <runDir> --task <taskId>` resolves a
  dynamic realization owner from saved artifacts and joins any recorded runtime
  executions.

## Output Contract

Generated story directories now write a modern package:

- `story.json` — primary versioned story package.
- `manifest.json` — declares `primaryStoryFile` and records the story package
  checksum when available.

The proxy catalog reads `manifest.json` first, then falls back to `story.json`.
Legacy-only directories must be migrated before runtime load. The client fetch
path trusts `story.json` on disk through `/stories/:id` after worker completion
rather than relying on the transient worker result blob.

Media references are resolved through `src/assets/assetResolver.ts` and
`src/services/storyLibrary.ts`. Modern packages may carry content-addressed
`AssetRef` objects; legacy string paths remain supported.

Reader-safe content exports are produced by `npm run content:reader:export` or
`npm run reader:export:with-content`. The export intentionally omits prompts,
checkpoints, job state, LoRA artifacts, source uploads, and diagnostics.

## Active Compatibility Boundaries

- `ImageGenerator.ts` has been removed. Active image definitions live in
  `src/ai-agents/images/imageTypes.ts`, and active work flows through
  storyboard-v2, `ImageAgentTeam`, and `ImageGenerationService`.
- Legacy generated stories are still supported through codec migrations and the
  migration script, not catalog fallback reads.
- The old `useapi` provider name should be treated as historical. Current
  provider selection uses `midapi`.
- Image-team coordinator and visual-check scaffolds are present, but the live
  path is the storyboard-v2 / `ImageAgentTeam` / `ImageGenerationService`
  flow, with `VisualQualityJudge` and modular `visualChecks` used where wired.
- The old monolithic `App.tsx` shell has been removed; `apps/reader` and
  `apps/generator` are the bundle/deployment entries.
- Stable Diffusion supports the A1111/Forge backend today. Other backend enum
  names are future adapter placeholders.
- LoRA training is Stable-Diffusion-only and concretely wired through the
  `kohya` sidecar adapter.

## Concurrency and Resumability

The pipeline uses local worker queues, semaphores, and provider throttles rather
than a second orchestration pipeline. LLM concurrency is controlled in
`BaseAgent`; image and audio work use local queues; provider RPM/concurrency
limits live in `providerThrottle.ts` and the image service adapters.

Workers persist job state, checkpoints, dead-letter state, checkpoint output
files, and sanitized timelines through `proxy/workerLifecycle.js`.

Analysis workers checkpoint `source_analysis` immediately after the analyzer
succeeds, before starting `season_plan`. A deterministic season-plan failure can
resume from the saved source analysis without repeating the provider call.

Provider/model selection remains part of the immutable job configuration, while
provider credentials are server-owned during worker hydration. When a matching
server credential exists it overrides stale browser-persisted key material before
the config hash and provider preflight are evaluated.

The proxy also normalizes stale/orphaned jobs on startup and periodically
prunes completed jobs, orphaned checkpoints, stale MidAPI callbacks, and old
worker result cache entries. High-memory relief trims large worker timelines,
image job lists, video job lists, and checkpoint outputs before forcing GC when
available.

## Current Command Notes

Run commands from `storyrpg-prototype/`.

- `npm run reader:web` starts the public reader target on port 8081.
- `npm run generator:web` starts the internal generator target on port 8082.
- `npm run dev` starts the proxy plus reader target.
- `npm run reader:export` is the Vercel/public build command.
- `npm run generator:export:internal` exists for internal inspection only.
- `npm run validate:reader` checks reader type safety, reader/generator
  boundary safety, and focused reader tests.
