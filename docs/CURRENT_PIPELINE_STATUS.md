# Current Pipeline Status

**Last Updated:** July 19, 2026

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

## Canonical Job Launch Boundary

Generator UX and headless worker tools prepare jobs through
`src/ai-agents/launch/GenerationLaunchService.ts`. That service owns model-family
resolution, provider-policy enforcement, episode scope, manifest commitment,
generation preflight, immutable request snapshots, and launch fingerprints.
Callers submit the resulting protocol-v2 request through `WorkerJobClient`; they
must not assemble `/worker-jobs/start` payloads or import private screen/hook
configuration modules. `npm run check:launch-boundary` enforces that ownership,
and `tsconfig.tools.json` typechecks operational generation tools.

The proxy validates the complete versioned request before it creates a job or
spawns a worker. Generation requests always carry the same manifest both in the
worker input and embedded creative brief. Completed worker results are written
under `.worker-results/<jobId>/result.json`, hashed at commit, and reloaded from
disk when the in-memory cache is empty, including after a proxy restart. Result
retention follows the worker-job retention window rather than the short memory
cache TTL.

The versioned batch shorthand is **Variant Batch** (`kind: "variant-batch"`).
It atomically admits two to four ordinary generation jobs with identical locked
analysis, season-plan, manifest, and pipeline configuration. The children run
the rest of `FullStoryPipeline` independently and concurrently. Each has an
isolated memory scope and output package; all remain reader-held until one
quality-eligible child is explicitly selected. Story-worker concurrency defaults
to four and is hard-capped at four.

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
4. **Enforce** — plan-time fidelity + `EpisodeSpineContractValidator`; every
   scene completes prose, choices, encounter content, deterministic
   projections, critic review, and owner validation before receiving a commit
   receipt. Episode and final text contracts are read-only regression nets.
   A blocker invalidates the owning scene and dependent suffix (or routes an
   architectural class to plan regeneration); it never reopens a sealed scene.
   Source-required choice semantics are hard-pinned while ordinary taxonomy is
   reallocated against the feasible episode slice before prose generation.
   Choice-terminal departure and companion handoffs belong to every
   ChoiceAuthor outcome; successor-scene responsiveness is authored and graded
   through the same flag-conditioned text variants the Reader selects.
   Choice-bearing scenes also split relationship, state-change, aftermath, and
   dependent event atoms onto ChoiceAuthor's all-outcome surface; SceneWriter
   owns only the pre-choice setup. Owner-stage repair is atom-monotonic across
   blocking tasks: a candidate must strictly shrink the unresolved evidence set
   without losing blocking meaning that already passed on the same route.
   Advisory regressions remain critic feedback and telemetry instead of vetoing
   a blocking improvement. Accepted atom reduction and true stalls have separate
   bounded budgets, so a converging `4 -> 2 -> 1 -> 0` repair sequence is not discarded
   after two useful patches. Positive semantic receipts are scoped to the
   judge's cited evidence hashes and remain valid through same-scene additive
   surfaces while those witnesses remain unchanged; changed witnesses and all
   forbidden atoms are re-judged. Shared choice-resolution misses use an
   LLM-authored append/prepend patch that preserves accepted shared prose and
   choice geometry; replacement is reserved for removing forbidden meaning.
   SceneWriter semantic patches preserve authored insertion order, reject
   serialized or agent-facing text and invalid evidence references before
   judging, and receive only blocking forbidden constraints implicated by the
   repair. Conflicting duplicate beat ids use a bounded structured-output
   correction and retain their typed failure classification when exhausted.
   Twist materialization binds to either ordinary scene beats or EncounterArchitect
   prose surfaces, matching the artifact that owns reader-facing text.
5. **Media** — post-story images/video/audio after the text contract passes.

Skip telemetry (debug events): `thread_twist_skipped_authored_lite`,
`character_arc_skipped_authored_lite`, `branch_annotation_skipped_authored_lite`.

Cognee remains advisory-only: index compiled ESC/ledger facts, not competing
LLM plans.

### Package quality promotion

Generation completion and Reader publication are separate outcomes. Every new
retained package writes an atomic `quality-disposition.json` derived from the
run score, quality caps, QA evidence freshness, and a treatment/config-scoped
best-known baseline. `ship` packages are promoted; `warn` and `block` packages
remain available to generator diagnostics but are excluded from local and GCS
Reader catalogs unless an explicit audited override is present. When equally
complete promoted packages exist, the catalog chooses the highest-quality
package before using recency as a tie-breaker.

Historical packages without an explicit disposition remain Reader-visible for
backward compatibility. Legacy manifest scores inform ranking and diagnostics
only; the proxy does not reinterpret them as retroactive publication decisions.

An override is recorded with `npm run quality:override -- --run <run-dir> --approved-by <identity> --reason <reason>`. It updates only the promotion
receipt and appends `quality-override-audit.jsonl`; it never changes scores,
caps, QA evidence, or story content.

An already-packaged run can be withdrawn without changing its story or score via
`npm run quality:hold -- --run <run-dir> --held-by <identity> --reason <reason>
[--superseded-by <run-dir>]`. This writes an explicit held disposition and an
append-only `quality-hold-audit.jsonl` record; the mechanism is story-agnostic.

Source analysis now carries explicit protagonist pronouns. `prepareGenerationJob`
treats caller briefs as provisional and compiles identity from source analysis,
the locked season plan, and explicit overrides. Missing or legacy-placeholder
identity is normalized with telemetry; genuine name-vs-name contradictions fail
before provider work. Workers repeat this normalization before preflight so old
resume payloads use the same policy, and the proxy persists the normalized
identity into the next resume context. Placeholder names such as `Hero` or
`The Hero` cannot become final-validator aliases. Final-contract repair is monotonic across
blocking and advisory canonical findings, so a rewrite that loses a previously
realized anchor is rolled back rather than committed.

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
   `CallbackLedger` and optional per-scene `SceneCritic` review.
6. Mechanical story metadata: story verbs, affordance sources, witness
   reactions, failure residue, branch-shadow diagnostics, and visualizer
   diagnostics where enabled.
7. Validation: incremental per-scene checks before commit; read-only quick best-practices checks,
   LLM QA, branch/divergence checks, scene graph checks, setup/payoff checks,
   twist checks, arc-delta checks, mechanical storytelling checks, sequence
   continuity audits, and treatment-fidelity checks.
8. Post-story media: after story authoring, per-episode QA, and episode
   failure gates complete, the pipeline runs master reference visuals,
   storyboard-v2 beat imagery, `ImageAgentTeam`, encounter imagery,
   provider-aware reference packs, structured art-style profiles,
   preapproved style anchors, optional Stable-Diffusion LoRA training,
   optional video generation, and optional ElevenLabs narration.
9. Finalization: read-only runtime `Story` assembly from the story-first episodes plus
   post-story media assets, `SavingPhase`,
   `pipelineOutputWriter`, story codec packaging, asset HTTP validation,
   optional Playwright multi-path QA, and image remediation/re-save when
   possible.

### Optional Story Council (`storyCouncil.enabled`)

The Generator's **Story Council** switch is the single master gate for the
planning swarm and its independent holdouts. Off means the normal
`FullStoryPipeline` path: no council agents are constructed, no candidate calls
run, and no council artifacts are written. Persisted `qualityCouncil*` settings
are migrated to the canonical `storyCouncil*` fields for compatibility.

The first live candidate stage is invent-mode episode architecture. Two to four
independent `StoryArchitect` seats receive the same locked canon/graph context
and different craft directives. The primary architect supplies the baseline;
when model-family routing provides a council-plan assignment, alternate seats
use that model as a planning expert. This is a bounded swarm, not a serial
review: seats run concurrently under run-wide call, token, concurrency, and
remediation budgets.

Every candidate is projected onto locked scene shells and must pass the existing
deterministic architecture, scene-order, `EpisodeEventPlan`, and
`NarrativeContractGraph` checks before comparison. The blinded comparison model
can select only qualified artifacts. `shadow` records the result but keeps the
baseline; `select` adopts the qualified winner; `select-and-repair` may ask the
canonical owner for one fresh synthesis of complementary finalist merits, then
qualifies and compares that artifact again. Synthesis never mechanically merges
JSON and never changes authored topology. Authored-lite architecture remains on
its deterministic fill-slots path because its ESC-owned topology leaves no
legitimate candidate search space.

The old plan/choice "review at the end" checkpoints are retired from the active
path. Route-playtest, final, and optional OpenRouter Fusion calls remain as
independent holdouts. Their findings can identify a repair owner and appear in
quality evidence, but they have no validator authority: a holdout finding or
transport/parser failure cannot block generation or cap publishability unless a
canonical validator independently reproduces the defect.

Council evidence is inspectable and resumable. Episode artifact indexes retain
`story-council-candidate-set` and `story-council-decision` revisions upstream of
the selected `episode-blueprint`; final holdouts are stored as a revisioned
`story-council-holdout`. The output bundle writes
`07d-story-council-report.json` plus the former filename as a temporary
compatibility alias. The report records candidates generated/qualified,
synthesis use, call usage, and infrastructure failures.

Season-plan, foundation, choice, encounter, and narrative-scaffolding candidate
flags exist in the internal config contract but remain false and are not exposed
in the Generator until those owners have stage-specific qualification and
artifact persistence. This prevents a broad toggle from silently enabling
unimplemented or topology-unsafe swarms.

`SavingPhase` and `WorldBuildingPhase` are wired active paths under
`src/ai-agents/pipeline/phases/`. Continue phase extraction as
behavior-preserving migrations.

## Canonical Narrative Realization Contract

`NarrativeContractGraph` and `EpisodeEventPlan` version 10 compile premise,
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
A negative verdict requires a second sample. Disagreement, persistent
uncertainty, or two correlated negative samples invokes a focused claim-level
adjudication pass. Its categorical verdict is decisive; an unavailable or
uncertain adjudication remains an infrastructure or inconclusive outcome rather
than being converted into a content miss. Task thresholds are evaluated before
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
outcome. If that dedicated passage alone misses its canonical meaning, a bounded
LLM repair rewrites only `sharedResolutionText`, removes its prior projection,
and rematerializes the repaired prose while preserving valid option geometry,
consequences, and tier-specific reactions. Branch regeneration and deterministic
fallbacks cannot claim this repair class. No deterministic system invents the payoff. Generic group names are
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
Repair feedback is semantic-role aware without becoming deterministic prose:
relationship changes require an observable bid, reciprocity, and changed
footing; introductions preserve the named introducer; information transfers
preserve the specified speaker; and actions, decisions, state changes, and
aftermath must be staged through their completion threshold. The authoring LLM
chooses the fiction-first realization and the semantic judge remains the sole
authority over its meaning.
SceneWriter-owned semantic misses use an LLM-authored
`SceneSemanticPatch` against the immutable baseline: at most two adjacent beat
texts or one transition may be replaced or inserted, while deterministic code
checks the base hash and applies the returned text operations. The loop accepts
at most two authored candidates and bounds provider/patch calls separately.
The active content path no longer inserts deterministic required-moment prose.
Repair candidates are immutable snapshots and are replay-validated;
non-identical findings for the same snapshot fail with a typed
`validator_snapshot_mismatch` error. A candidate is adopted only when it clears
the targeted fingerprint without introducing a newly failing task; atom-level
fingerprints may move only within tasks that were already blocking. Each patch
request also carries every currently passing positive atom from every scene-owned
task as immutable preserve guidance, rather than protecting only siblings of the
target atom. Production patches permit up to three operations over the same two
adjacent beats, or four only after an explicit expanded-capacity escalation; the
whole candidate still replays every scene-owned task before adoption. Unresolved SceneWriter-owned tasks abort
before ChoiceAuthor, callback accounting, completion status, or checkpointing.
Failed candidates and full semantic receipts are persisted before failure for
deterministic replay. Typed failure code, owner stage, retry class, issue codes,
artifact references, and repair target survive the episode, worker, and proxy
boundaries. Semantic verdicts are cached by task, atom, scoped evidence, judge
policy, provider, model, and schema. Positive receipts may be reused after
unrelated prose changes only when every cited excerpt still exists with the
same text hash; inconclusive and infrastructure-failure verdicts are never
cached. Scene authoring is a sequential commit protocol. For each standard
scene the pipeline completes `SceneWriter`, choice materialization, incremental
validation/regeneration, optional `SceneCritic` review, realization handoff,
producer validation, callback accounting, and a versioned scene commit receipt
before the next scene is authored. The next scene therefore receives the
critic-final realized closing prose. Scene and episode-draft checkpoints carry
the receipt hashes; resume rejects missing or mismatched committed drafts. A
critic candidate is an immutable clone, may replace only prose
fields, and is adopted only after required-moment, POV, realization-task, and
incremental-regression checks pass.

Required-beat misses no longer use a two-tier defer policy. After the bounded
SceneWriter retry, concrete missing moments fail the current scene; summary-
shaped contracts require semantic proof at the precommit owner gate. Requested
episode QA must also complete successfully before the episode can be sealed.

There are no late narrative mutators in the active pipeline. Choice route
canonicalization, bridge materialization, reader-text sanitation, protagonist
template resolution, encounter POV/outcome-flag/clock normalization,
callback/payoff annotation, episode-final cliffhanger
repair, per-owner twist beat binding, and optional `SceneCritic` rewriting all
run before the receipt is issued. Twist foreshadow metadata is bound while the
foreshadow scene is mutable; generating the reveal never reopens it. The receipt hashes the complete `SceneContent`, its realized handoff,
the scene-scoped `ChoiceSet`, and any `EncounterStructure`. Quick validation,
QA, scene-graph validation, assembly, episode lock validation, and the final
contract may only report findings. After each such phase the orchestrator
rechecks receipts and aborts on any mutation. Corrective action is explicit
invalidation plus regeneration of the earliest owning scene and every dependent
scene, never receipt refresh or in-place repair.

Every initial or regenerated choice set passes one transactional
prepare/validate/commit path: canonical state setters, information markers,
residue, and route fan-out are applied to a clone; owner and producer gates run
on that exact clone; only a valid candidate replaces the committed choice set
and its within-episode plant projection. Route evidence
is evaluated per playable outcome and cannot be borrowed across routes or from
an undeclared surface. `NarrativeContractValidator` and the asynchronous final
contract repeat checks on isolated validation projections; any legacy
normalization performed inside a validator is discarded and emits a blocking
`late_normalization_required` finding, so a repaired projection cannot mask a
defect in the sealed bytes. Scene locks preserve all scene-time errors as
blockers; they never demote craft failures for a later repair loop. The owner-stage
fingerprint is preserved through final regression accounting. Each owner
evaluation emits a receipt containing the task
IDs, owner stage, candidate hash, finding fingerprints, judge identity,
categorical verdicts, evidence references, response hash, and sample count. The
per-scene pass is a regression net and must match
the union of those receipts exactly; missing owner artifacts fail as
`owner_stage_not_executed`, while divergent fingerprints fail as
`owner_stage_coverage_mismatch` without a blind LLM retry.

Three older event heuristics (viral payoff, exact codename, and all-route threat
checks) remain only for persisted graphs that have no compiled realization task.
They do not execute alongside a current canonical task and are tracked for deletion in
`docs/LEGACY_REMOVAL_REGISTRY.md`.

Version 10 also makes continuity-producing facts explicit before authoring.
Semantic event propositions identify exact lexical artifacts (coined names,
handles, titles, group names, and codewords) at the proposition that creates
them. The graph projects their creator event/scene, pre-creation prohibition,
and source-invariant versus player-selected route policy. Scene plans also
carry transactional entry/exit state, one canonical first-appearance owner,
route-visible-residue requirements, and canonical encounter participants.
SceneWriter, ChoiceAuthor, and EncounterArchitect receive only their local
projections. Deterministic code validates identities, ordering, route surfaces,
and participant parity; semantic judges remain responsible for whether prose
actually earns a coinage, relationship change, or other interpretive turn.

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

Worker polling and SSE status frames are summary-only: large step outputs stay
in proxy-owned checkpoint files, timeline entries carry compact completion
evidence, and the generator fetches the transient completion payload once from
`/worker-jobs/:jobId/result`. Startup migration removes duplicated outputs from
older worker and generation-job mirrors.

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
