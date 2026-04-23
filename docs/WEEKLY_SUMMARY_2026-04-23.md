# StoryRPG — Weekly Change Summary (Apr 16 – Apr 23, 2026)

Synthesized from git history over the past seven days. Most hourly commits are
unlabeled auto-saves, so this summary is derived from file-level additions,
deletions, and diff stats rather than commit messages.

## Image pipeline — the largest area of work

The three descriptively-named commits on Apr 16 all target this area, plus
heavy churn throughout the week in `imageGenerationService.ts` (+1,625 lines)
and `ImageAgentTeam.ts` (+408).

- **Art direction & prompt core** — new
`[artStyleProfile.ts](../storyrpg-prototype/src/ai-agents/images/artStyleProfile.ts)`,
`[cinematicPromptCore.ts](../storyrpg-prototype/src/ai-agents/images/cinematicPromptCore.ts)`,
`[anchorPrompts.ts](../storyrpg-prototype/src/ai-agents/images/anchorPrompts.ts)`,
and `[artStylePresets.ts](../storyrpg-prototype/src/ai-agents/config/artStylePresets.ts)`
(commit `3141816`: "D8 drift audit, C5 style-aware validators, B3/B8 prompt core").
- **Provider abstraction & throttling** — new
`[providerCapabilities.ts](../storyrpg-prototype/src/ai-agents/images/providerCapabilities.ts)`,
`[providerThrottle.ts](../storyrpg-prototype/src/ai-agents/services/providerThrottle.ts)`,
`[referenceStrategy.ts](../storyrpg-prototype/src/ai-agents/images/referenceStrategy.ts)`,
and adapters for Atlas Cloud, Gemini, MidAPI, and A1111 under
`src/ai-agents/services/providers/` and `src/ai-agents/services/stable-diffusion/`.
- **A3-narrow parallel prefetch** of scene-opening beats (commit `4ddbcd5`) —
changes in `FullStoryPipeline.ts` (+2,863 lines this week) and
`imageGenerationService.ts`.
- **LoRA auto-training subsystem (brand new)** —
`[LoraTrainingAgent.ts](../storyrpg-prototype/src/ai-agents/agents/image-team/LoraTrainingAgent.ts)`,
`[loraRegistry.ts](../storyrpg-prototype/src/ai-agents/images/loraRegistry.ts)`,
`[datasetBuilder.ts](../storyrpg-prototype/src/ai-agents/images/datasetBuilder.ts)`,
`[KohyaAdapter.ts](../storyrpg-prototype/src/ai-agents/services/lora-training/KohyaAdapter.ts)`,
plus the new `[docs/LORA_TRAINING.md](./LORA_TRAINING.md)`.
- **Visual QA refactor** — `VisualNarrativeValidator` and `DramaExtractionAgent`
removed; replaced by
`[VisualQualityJudge.ts](../storyrpg-prototype/src/ai-agents/agents/image-team/VisualQualityJudge.ts)`
and modular
`[visualChecks/CompositionCheck.ts](../storyrpg-prototype/src/ai-agents/agents/image-team/visualChecks/CompositionCheck.ts)`.

## Story-structure agents & validators consolidated

Major rewrite of the narrative generation side.

- **New agents**:
`[TwistArchitect.ts](../storyrpg-prototype/src/ai-agents/agents/TwistArchitect.ts)`,
`[ThreadPlanner.ts](../storyrpg-prototype/src/ai-agents/agents/ThreadPlanner.ts)`,
`[CharacterArcTracker.ts](../storyrpg-prototype/src/ai-agents/agents/CharacterArcTracker.ts)`,
`[StyleArchitect.ts](../storyrpg-prototype/src/ai-agents/agents/StyleArchitect.ts)`,
`[SceneCritic.ts](../storyrpg-prototype/src/ai-agents/agents/SceneCritic.ts)`.
- **Removed (consolidated into `SceneWriter` / new agents)**: `BeatWriter`,
`DialogueSpecialist`, `ScriptCompiler`, `ResolutionDesigner`, `VariableTracker`,
`PlaytestSimulator`, `BlueprintGrowthCritic`, `GrowthNarrativeCritic`,
`SeasonArchitect`.
- **New validators**:
`[SevenPointCoverageValidator](../storyrpg-prototype/src/ai-agents/validators/SevenPointCoverageValidator.ts)`,
`CallbackCoverageValidator`, `ArcDeltaValidator`, `SetupPayoffValidator`,
`TwistQualityValidator`, `DivergenceValidator`, plus
`[pathSimulator.ts](../storyrpg-prototype/src/ai-agents/validators/pathSimulator.ts)`.
- **I5 branch-shadow-diff sidecar** (commit `97dcc63`) — runtime comparison of
LLM output vs. deterministic engine.

## Callback ledger / delayed-consequences groundwork

New infrastructure matching the three plan docs added this week.

- `[callbackLedger.ts](../storyrpg-prototype/src/ai-agents/pipeline/callbackLedger.ts)`
and
`[callbackPromptSection.ts](../storyrpg-prototype/src/ai-agents/prompts/callbackPromptSection.ts)`.
- New plan docs: `[PLAN_DELAYED_CONSEQUENCES.md](./PLAN_DELAYED_CONSEQUENCES.md)`,
`[PLAN_MULTI_SCENE_BRANCH_ZONES.md](./PLAN_MULTI_SCENE_BRANCH_ZONES.md)`,
`[PLAN_POST_EPISODE_FLOWCHART.md](./PLAN_POST_EPISODE_FLOWCHART.md)`.

## Pipeline orchestration & codec

- Dedicated **codec module**:
`[storyCodec.ts](../storyrpg-prototype/src/ai-agents/codec/storyCodec.ts)`,
`[storyManifest.ts](../storyrpg-prototype/src/ai-agents/codec/storyManifest.ts)`,
`[assetIndex.ts](../storyrpg-prototype/src/ai-agents/codec/assetIndex.ts)`,
plus versioned migrations (`v1ToV2.ts`, `v2ToV3.ts`).
- Pipeline modularized into
`[checkpointing.ts](../storyrpg-prototype/src/ai-agents/pipeline/checkpointing.ts)`,
`[events.ts](../storyrpg-prototype/src/ai-agents/pipeline/events.ts)`,
new `[SavingPhase.ts](../storyrpg-prototype/src/ai-agents/pipeline/phases/SavingPhase.ts)`,
and `[PipelineClient.ts](../storyrpg-prototype/src/ai-agents/pipeline/PipelineClient.ts)`.

## Proxy server modularization

`proxy-server.js` shrank by **2,718 lines**; its contents moved into dedicated
route modules under `proxy/`:

- `[workerLifecycle.js](../storyrpg-prototype/proxy/workerLifecycle.js)` (+1,191),
`[elevenLabsRoutes.js](../storyrpg-prototype/proxy/elevenLabsRoutes.js)`,
`[midApiRoutes.js](../storyrpg-prototype/proxy/midApiRoutes.js)`,
`[imageFeedbackRoutes.js](../storyrpg-prototype/proxy/imageFeedbackRoutes.js)`,
`anthropicProxyRoutes.js`, `atlasCloudRoutes.js`, `loraTrainingRoutes.js`,
`memoryRoutes.js`, `generationJobRoutes.js`, `styleRoutes.js`, `storyCodec.js`,
`atomicIo.js`, `checkpointLog.js`.

## Generator UI overhaul

Step-based flow replacing the monolithic `GeneratorScreen`.

- New `[src/screens/generator/](../storyrpg-prototype/src/screens/generator/)`
with `[StepIndicator.tsx](../storyrpg-prototype/src/screens/generator/StepIndicator.tsx)`,
`[StyleSetupSection.tsx](../storyrpg-prototype/src/screens/generator/StyleSetupSection.tsx)`,
`[AdvancedSettingsSheet.tsx](../storyrpg-prototype/src/screens/generator/AdvancedSettingsSheet.tsx)`,
`[useStyleSetup.ts](../storyrpg-prototype/src/screens/generator/hooks/useStyleSetup.ts)`,
and step frames (`StoryStep`, `StyleStep`, `ReviewStep`, `ProgressStep`,
`CompleteStep`).
- New `[EpisodeRecapScreen.tsx](../storyrpg-prototype/src/screens/EpisodeRecapScreen.tsx)` (+609).

## Type-system split

`src/types/index.ts` shrank by ~1,495 lines, relocated into domain files:
`[story.ts](../storyrpg-prototype/src/types/story.ts)`,
`[choice.ts](../storyrpg-prototype/src/types/choice.ts)`,
`[conditions.ts](../storyrpg-prototype/src/types/conditions.ts)`,
`[consequences.ts](../storyrpg-prototype/src/types/consequences.ts)`,
`[content.ts](../storyrpg-prototype/src/types/content.ts)`,
`[encounter.ts](../storyrpg-prototype/src/types/encounter.ts)`,
`[narrativeThread.ts](../storyrpg-prototype/src/types/narrativeThread.ts)`,
`[player.ts](../storyrpg-prototype/src/types/player.ts)`.

## Engine, stores, tests & CI

- New `[rewindEngine.ts](../storyrpg-prototype/src/engine/rewindEngine.ts)` plus
tests for `identityEngine` and `growthConsequenceBuilder`.
- New store
`[createJobStore.ts](../storyrpg-prototype/src/stores/createJobStore.ts)`
plus test; meaningful churn in `gameStore.ts`, `imageJobStore.ts`,
`videoJobStore.ts`.
- Added `[.github/workflows/ci.yml](../.github/workflows/ci.yml)` and enabled
Vitest coverage output (full lcov report now checked in under `coverage/`).

## Documentation

- **Added**: `LORA_TRAINING.md`, the three `PLAN_`* docs, and `CLAUDE_INSTALL.md`.
- **Substantial revisions**: `[IMAGE_PIPELINE_RUNTIME.md](./IMAGE_PIPELINE_RUNTIME.md)`,
`[TDD.md](./TDD.md)`, `[INSTALL.md](./INSTALL.md)`,
`[AGENTS.md](../AGENTS.md)`.

---

**Net change over the week:** 541 files, roughly **+266k / -13.5k lines**.
A large fraction of the additions are committed coverage HTML and
`package-lock.json` churn; excluding those, the meaningful source delta is on
the order of tens of thousands of lines.