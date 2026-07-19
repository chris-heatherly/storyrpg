# StoryRPG: Complete System Architecture Document

**Last Updated:** May 25, 2026

A comprehensive reference for the story agent structure, storytelling rules, branching mechanics, and choice determination systems.

Read `docs/PROJECT_STATUS.md` for the current app/proxy/deployment snapshot.
This file focuses on agents, runtime mechanics, generation flow, and validation.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [AI Agent Architecture](#2-ai-agent-architecture)
3. [The Generation Pipeline](#3-the-generation-pipeline)
4. [Core Storytelling Rules](#4-core-storytelling-rules)
5. [Choice System](#5-choice-system)
6. [Branching & Scene Navigation](#6-branching--scene-navigation)
7. [The Encounter System](#7-the-encounter-system)
8. [Resolution Engine (Stat Checks)](#8-resolution-engine-stat-checks)
9. [Consequence System](#9-consequence-system)
10. [Identity Engine](#10-identity-engine)
11. [Condition Evaluation](#11-condition-evaluation)
12. [Template Processing](#12-template-processing)
13. [Validation Framework](#13-validation-framework)
14. [State Management](#14-state-management)
15. [Cross-Episode Continuity](#15-cross-episode-continuity)
16. [Configuration Reference](#16-configuration-reference)
17. [File Reference](#17-file-reference)

---

## 1. System Overview

StoryRPG is an AI-driven interactive fiction platform that generates and plays branching narrative experiences. The system is built on three pillars:

1. **Generation** — A multi-agent AI pipeline that transforms a story brief into a complete interactive narrative with scenes, choices, encounters, consequences, images, and optional video.
2. **Engine** — A runtime system that plays the generated story, handling scene navigation, choice filtering, stat checks, consequence application, and text rendering.
3. **State** — A persistent player state model that tracks attributes, skills, relationships, flags, scores, tags, inventory, identity profile, and branch history.

The platform is built as a React Native/Expo app with a public Reader target
and an internal Generator target. LLM integration supports Anthropic, OpenAI,
and Gemini. Image generation supports Gemini (`nano-banana`), Atlas Cloud,
MidAPI/Midjourney, Stable Diffusion A1111/Forge, placeholder fallback, and
legacy compatibility aliases.

### Architectural Layers

```
┌──────────────────────────────────────────────────────┐
│                    UI Layer                           │
│  ReaderApp · GeneratorApp · ReadingScreen             │
│  GeneratorScreen · SettingsScreen · VisualizerScreen  │
├──────────────────────────────────────────────────────┤
│                 State Layer                           │
│  gameStore (React Context) · settingsStore (Zustand + │
│  provider wrapper) · generatorSettingsStore           │
│  appNavigationStore · generationJobStore             │
│  imageJobStore · videoJobStore · seasonPlanStore      │
│  imageFeedbackStore · encounterStatePersistence       │
│  playerStatePersistence · AsyncStorage persistence    │
├──────────────────────────────────────────────────────┤
│                Engine Layer                           │
│  storyEngine · resolutionEngine · conditionEvaluator │
│  templateProcessor · identityEngine                  │
│  growthConsequenceBuilder                           │
├──────────────────────────────────────────────────────┤
│              Generation Layer                         │
│  FullStoryPipeline (authoritative)                   │
│  AI Agents · Validators · Prompts                    │
│  Storyboard-v2 · Image/Video/Audio Infrastructure     │
├──────────────────────────────────────────────────────┤
│                Provider Layer                         │
│  Anthropic · OpenAI · Gemini · Atlas · MidAPI · SD    │
│  ElevenLabs · kohya LoRA sidecar                     │
└──────────────────────────────────────────────────────┘
```

---

## 2. AI Agent Architecture

### 2.1 BaseAgent

All agents extend `BaseAgent` (`src/ai-agents/agents/BaseAgent.ts`), which provides:

- **Multi-provider LLM calls**: `callAnthropic()`, `callOpenAI()`, `callGemini()` — selected at runtime based on `AgentConfig.provider`.
- **Automatic system prompt injection**: When `includeSystemPrompt = true`, the agent's system prompt (core storytelling principles + agent-specific instructions) is prepended to every LLM call.
- **Retry with exponential backoff**: Transient errors (network, 5xx, rate limits) retry up to 2 times with jittered exponential backoff.
- **Circuit breaker**: After 5 consecutive failures across ALL agents, all LLM calls pause for 60 seconds before retrying.
- **Concurrency guardrails**: Global semaphore (default 4 in-flight) and per-provider semaphore (default 2 in-flight) prevent overloading APIs. Configurable via `llmMaxGlobalInFlight` and `llmMaxPerProviderInFlight` in `GenerationSettingsConfig`.
- **JSON parsing with repair**: `parseJSON()` strips markdown code blocks, repairs truncated responses, fixes missing braces, balances brackets, removes trailing commas, and quotes unquoted property names. Additional utilities in `src/ai-agents/utils/llmParser.ts`.
- **Claude Memory support**: Optional `callAnthropicWithMemory()` enables Claude's memory tool for multi-turn context retention across pipeline runs. Configured via `MemoryConfig` in `PipelineConfig`.
- **Quota detection**: `LLMQuotaError` and `isLlmQuotaError()` for handling provider credit exhaustion.

**System prompt structure:**

```
You are [Agent Name], an expert AI agent specialized in interactive narrative design.

[CORE_STORYTELLING_PROMPT — shared across all agents]

[Agent-specific prompt — unique to each agent]

## Output Format
Always respond with valid JSON that matches the requested schema.
```

### 2.2 Agent Roster

#### Narrative / Structure Agents

| Agent | File | Role | Temperature |
|---|---|---|---|
| **Story Architect** | `StoryArchitect.ts` | Episode blueprints, scene graphs, branch-and-bottleneck structure, encounter placement | 0.7 |
| **Scene Writer** | `SceneWriter.ts` | Prose content for beats, atmosphere, dialogue, text variants. Absorbs the former `BeatWriter`, `DialogueSpecialist`, and `ScriptCompiler` roles. | 0.85 |
| **Scene Critic** | `SceneCritic.ts` | Optional transactional subtext/reversals review inside each standard scene's pre-commit transaction; gated by `config.sceneCritic.enabled`. Accepted prose is finalized and receipt-hashed before dependent scenes are authored; downstream QA/assembly cannot reopen it. | 0.7 |
| **Choice Author** | `ChoiceAuthor.ts` | Player choices, consequences, stat checks, branching routing. Resolution-check difficulty now authored inline (the old `ResolutionDesigner` is gone). | 0.75 |
| **Branch Manager** | `BranchManager.ts` | Branch analysis, reconvergence validation, state tracking | 0.7 |
| **Encounter Architect** | `EncounterArchitect.ts` | Encounter structure, skill challenges, decision trees, storylets | 0.75 |
| **World Builder** | `WorldBuilder.ts` | World bible, locations, cultures, history | 0.8 |
| **Character Designer** | `CharacterDesigner.ts` | NPC profiles, want/fear/flaw, voice, relationships | 0.8 |
| **Thread Planner** | `ThreadPlanner.ts` | Authors the `NarrativeThread` ledger driving setup/payoff tracking and delayed consequences | 0.7 |
| **Twist Architect** | `TwistArchitect.ts` | Schedules per-episode reversal/revelation with the required foreshadow beat(s) | 0.75 |
| **Character Arc Tracker** | `CharacterArcTracker.ts` | Per-episode identity/relationship milestone targets consumed by `ArcDeltaValidator` | 0.7 |
| **Style Architect** | `StyleArchitect.ts` | Expands arbitrary art-style strings into a structured `ArtStyleProfile`; falls back to `buildVerbatimProfile` so unknown styles never inherit cinematic vocabulary | 0.7 |
| **Season Planner** | `SeasonPlannerAgent.ts` | Season-level planning along the Story Circle spine (authoritative; replaces the old `SeasonArchitect`) | 0.7 |
| **Source Material Analyzer** | `SourceMaterialAnalyzer.ts` | IP analysis for adapted properties; emits anchors, Story Circle, and episode breakdown | 0.6 |

#### QA and Analysis Agents

| Agent | File | Role |
|---|---|---|
| **QA Agents** | `QAAgents.ts` | `ContinuityChecker`, `VoiceValidator`, `StakesAnalyzer`, `QARunner` |
| **Extended QA** | `QAAgents.ts` | `PlotHoleDetector`, `ToneAnalyzer`, `PacingAuditor`, `SensitivityReviewer`, `ExtendedQARunner` |

> **Removed in April 2026** (consolidated into `SceneWriter` or superseded by new structural agents): `BeatWriter`, `DialogueSpecialist`, `ScriptCompiler`, `ResolutionDesigner`, `VariableTracker`, `PlaytestSimulator`, `BlueprintGrowthCritic`, `GrowthNarrativeCritic`, `SeasonArchitect`. Growth-arc legibility is now covered by `CharacterArcTracker` + `ArcDeltaValidator`; variable tracking moved into `IncrementalContinuityChecker`.

#### Image Team Agents

| Agent | File | Role |
|---|---|---|
| **Image Agent Team** | `image-team/ImageAgentTeam.ts` | Orchestrator for all image/video generation and QA |
| **Storyboard Agent** | `image-team/StoryboardAgent.ts` | Shot rhythm, transitions, color/mood, motifs |
| **Visual Illustrator** | `image-team/VisualIllustratorAgent.ts` | Beat illustration prompts |
| **Encounter Image Agent** | `image-team/EncounterImageAgent.ts` | Cinematic encounter image prompts |
| **Character Reference Sheet** | `image-team/CharacterReferenceSheetAgent.ts` | Reference sheets, expression sheets, body vocabulary, acting direction |
| **Color Script Agent** | `image-team/ColorScriptAgent.ts` | Episode color arc and thumbnails |
| **Video Director** | `image-team/VideoDirectorAgent.ts` | Video direction for Veo pipeline |
| **LoRA Training Agent** | `image-team/LoraTrainingAgent.ts` | Orchestrates auto-train-LoRA eligibility, dataset assembly, dispatch, and cache lookups (Stable-Diffusion-only) |

#### Image QA Validators

| Agent | File |
|---|---|
| **Visual Quality Judge** | `image-team/VisualQualityJudge.ts` — replaces the older `VisualNarrativeValidator` + `DramaExtractionAgent` pair |
| **Composition Check** | `image-team/visualChecks/CompositionCheck.ts` — modular check invoked by `VisualQualityJudge` |
| **Consistency Scorer** | `image-team/ConsistencyScorerAgent.ts` |
| **Composition Validator** | `image-team/CompositionValidatorAgent.ts` |
| **Transition Validator** | `image-team/TransitionValidator.ts` |
| **Pose Diversity Validator** | `image-team/PoseDiversityValidator.ts` |
| **Expression Validator** | `image-team/ExpressionValidator.ts` |
| **Body Language Validator** | `image-team/BodyLanguageValidator.ts` |
| **Lighting Color Validator** | `image-team/LightingColorValidator.ts` |
| **Visual Storytelling Validator** | `image-team/VisualStorytellingValidator.ts` |

> Removed in April 2026: `AssetAuditorAgent`, `DramaExtractionAgent`, and `VisualNarrativeValidator` were all replaced by `VisualQualityJudge` plus the modular `visualChecks/` directory.

#### Additional Support Agents

| Agent | File |
|---|---|
| **Character Action Library** | `image-team/CharacterActionLibrary.ts` |
| **Cinematic Beat Analyzer** | `image-team/CinematicBeatAnalyzer.ts` |
| **Lighting Color System** | `image-team/LightingColorSystem.ts` |
| **Visual Narrative System** | `image-team/VisualNarrativeSystem.ts` |
| **Visual Storytelling System** | `image-team/VisualStorytellingSystem.ts` |

### 2.3 LLM Provider Configuration

```typescript
interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;          // e.g. 'claude-sonnet-4-20250514', 'gemini-2.5-pro'
  apiKey: string;
  maxTokens: number;      // Default 4096
  temperature: number;    // 0.0–1.0
}
```

- **Anthropic**: Primary provider. Uses proxy server for web (CORS). Supports Claude Memory tool.
- **Gemini**: Used for image generation (via Nano Banana MCP) and as alternative text provider.
- **OpenAI**: Fallback provider. Standard chat completions API.

---

## 3. The Generation Pipeline

### 3.1 FullStoryPipeline

The `FullStoryPipeline` (`src/ai-agents/pipeline/FullStoryPipeline.ts`) is the authoritative story-generation path. `EpisodePipeline.ts` and `ParallelStoryPipeline` have been removed; new work should use `FullStoryPipeline` and its extracted phase modules.

```
1. Source Material Analysis (if adapting IP)
     ↓
2. Season Planning (optional, with Story Circle validation)
     ↓
3. World Building (World Builder → World Bible)
     ↓
4. Character Design (Character Designer → Character Profiles)
     ↓
5. Per-Episode Generation:
   a. Story Architect → Episode Blueprint (scene graph)
   b. Branch Manager + deterministic topology helpers
   c. Thread Planner / Twist Architect / Character Arc Tracker
   d. Scene Writer → Beat prose for each scene
   e. Choice Author → Choices for each choice point
   f. Encounter Architect → Encounter structure + storylets
   g. Incremental Validation → Per-scene/choice/encounter quality checks
   h. Quick Validation and LLM QA
   i. Image Generation → storyboard-v2, scene art, character refs, encounter images
   j. Video Generation (optional) → scene video via Veo
     ↓
6. Final Story Assembly + Output Writing (`story.json`, `manifest.json`)
```

`SavingPhase` is extracted and wired. `WorldBuildingPhase` is scaffolded under
`src/ai-agents/pipeline/phases/` but should be wired only as a
behavior-preserving phase migration.

### 3.2 Per-Episode Flow Inside FullStoryPipeline

Each episode goes through a sub-flow inside `FullStoryPipeline`:

1. **Blueprint Phase**: Story Architect creates the `EpisodeBlueprint` with branch structure, choice points, and encounter placement.
2. **Content Phase**: Scene Writer generates beat-level prose. Choice Author creates choices. Incremental validators check quality after each scene/choice.
3. **Encounter Phase**: Encounter Architect designs the encounter's internal structure — phases, approaches, decision trees, and storylets.
4. **Validation Phase**: Branch Manager validates branch structure. Various validators check types, percentages, budgets, and story principles.
5. **Image Phase**: storyboard-v2 and image agents generate scene art, character reference sheets, style anchors, encounter images, and visual content.
6. **Video Phase** (optional): VideoDirectorAgent generates video direction, VideoGenerationService renders via Veo.

### 3.3 Pipeline Parallelism

- **Variant Batch**: `kind: "variant-batch"` starts two to four independent full-story workers from the same locked analysis and season plan. Each child owns its complete downstream pipeline and output package.
- **Episode execution**: Sequential inside each story run so canon, setup/payoff, and prior-episode state remain ordered.
- **Image/audio/video worker queues**: `LocalWorkerQueue` handles local work queues; image worker mode is on by default and capped by generation settings.
- **LLM guardrails**: `BaseAgent` enforces global and per-provider in-flight limits, retries, jitter, and quota/circuit-breaker behavior.
- **Provider throttling**: Image providers use adapter-level rate/concurrency controls via `providerThrottle.ts`.

### 3.4 Pipeline Memory

The pipeline supports cross-generation memory via:
- `writeGenerationMemory`, `writeCharacterMemory`, `readCharacterMemory`, `readPipelineMemory` on `FullStoryPipeline`
- `MemoryStore` abstraction (`NodeMemoryStore`, `ProxyMemoryStore`) in `src/ai-agents/utils/memoryStore.ts`
- Claude Memory tool support when configured

### 3.5 Pipeline Timeouts

`src/ai-agents/utils/withTimeout.ts` provides `withTimeout` wrapper and `PIPELINE_TIMEOUTS` for preventing hung pipeline stages.

### 3.6 Pipeline Telemetry

`src/ai-agents/utils/pipelineTelemetry.ts` provides `PipelineTelemetry` for metric collection across pipeline stages.

### 3.7 Failure Policy

`GenerationSettingsConfig.failurePolicy` supports:
- `fail_fast` — stop pipeline on first critical failure
- `recover` — attempt to continue past non-critical failures

---

## 4. Core Storytelling Rules

All narrative agents receive the `CORE_STORYTELLING_PROMPT` from `src/ai-agents/prompts/storytellingPrinciples.ts` which embeds these principles:

### 4.1 Fiction-First Philosophy

The player never sees numerical values, dice rolls, or game mechanics. All outcomes are expressed through narrative text.

### 4.2 Stakes Triangle

Every meaningful choice MUST have:

| Component | Description |
|---|---|
| **WANT** (Desire) | What clear goal or desire drives this moment? |
| **COST** (Risk/Tradeoff) | What must be sacrificed, risked, or given up? |
| **IDENTITY** (Self-Definition) | What does this choice say about who the player is? |

### 4.3 Choice Geometry

| Level | Name | Branching? |
|---|---|---|
| Free | **Flavor/Expression** | Never |
| Medium | **Branching** | Yes |
| Variable | **Blind** | Varies |
| High | **Moral Dilemma** | Yes |

### 4.4 Consequence Budgeting

| Tier | Budget Target | Description |
|---|---|---|
| **Callback Lines** | ~60% | NPCs remember small details |
| **Scene Tints** | ~25% | Same scene, different flavor |
| **Branchlets** | ~10% | Entirely different scenes |
| **Structural Branches** | ~5% | Different story paths |

### 4.5 Three-Layer State Architecture

| Layer | Type | Usage |
|---|---|---|
| **Flags** | Booleans | Gate conditions, callback triggers |
| **Scores** | Integers | Thresholds and comparisons |
| **Tags** | Sets | Complex conditions, identity markers |

### 4.6 Five-Factor Impact Test

Every meaningful (non-expression) choice must affect at least ONE: Outcome, Process, Information, Relationship, or Identity.

### 4.7 NPC Depth Tiering

| Tier | Dimensions Required |
|---|---|
| **Core NPCs** | ALL 4 (trust, affection, respect, fear) |
| **Supporting NPCs** | At least 2 |
| **Background NPCs** | At least 1 |

### 4.8 Choice Density Requirements

| Rule | Cap |
|---|---|
| **First Choice** | Within 90 seconds of reading time |
| **Average Gap** | ≤120 seconds between choices |
| **Scene Density** | ≥40% of scenes must have a choice point |

Reading time: `word_count / 200 WPM × 60 = seconds`

---

## 5. Choice System

### 5.1 Choice Types

| Type | Target % | Can Branch? | Requirements |
|---|---|---|---|
| `expression` | ~20% | **NEVER** | Must set at least one flag for callback tracking |
| `relationship` | ~25% | Yes | Must include ≥1 relationship consequence. Must have statCheck. |
| `strategic` | ~30% | Yes | Must include statCheck |
| `dilemma` | ~25% | Yes | Must have statCheck. Must have consequences on every option. Must set tint flags. |

### 5.2 Choice Structure

```typescript
interface Choice {
  id: string;
  text: string;                           // 5–15 words, active voice, present tense
  choiceType: 'expression' | 'relationship' | 'strategic' | 'dilemma';
  nextSceneId?: string;                   // Creates a branch
  nextBeatId?: string;                    // Routes within same scene
  statCheck?: {
    attribute?: keyof PlayerAttributes;
    skill?: string;
    difficulty: number;                   // 1–100
  };
  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;
  consequences?: Consequence[];
  delayedConsequences?: DelayedConsequence[];
  outcomeTexts?: {
    success: string;
    partial: string;
    failure: string;
  };
  reactionText?: string;
  tintFlag?: string;
  stakesAnnotation?: { want: string; cost: string; identity: string; };
}
```

### 5.3 Choice Execution (Runtime)

1. **Condition re-check**: `evaluateCondition(choice.conditions, player)`
2. **Stat check** (if present): `resolveStatCheck(player, choice.statCheck)` → outcome tier
3. **Consequences collected** and applied
4. **Delayed consequences** queued
5. **Result returned** with routing info (`nextSceneId`, `nextBeatId`)

---

## 6. Branching & Scene Navigation

### 6.1 Three Types of Scene Navigation

| Type | Source | Priority |
|---|---|---|
| **Player-driven branch** | `Choice.nextSceneId` | Highest |
| **Conditional auto-routing** | `Scene.leadsTo[]` | Medium |
| **Sequential advancement** | Scene array order | Lowest |

### 6.2 Branching Rules (Hard Constraints)

1. Maximum 2 branching choice points per episode
2. Expression choices must NEVER branch
3. All branches must reconverge at bottlenecks
4. No dead ends or unreachable scenes
5. `nextSceneId` must reference a scene in the parent scene's `leadsTo` array

See `docs/STORY_BRANCHING.md` for comprehensive branching documentation.

---

## 7. The Encounter System

### 7.1 Encounter Types

```typescript
type EncounterType =
  | 'combat' | 'chase' | 'heist' | 'negotiation'
  | 'investigation' | 'survival' | 'social' | 'romantic'
  | 'dramatic' | 'puzzle' | 'exploration' | 'stealth' | 'mixed';
```

### 7.2 Encounter Narrative Styles

```typescript
type EncounterNarrativeStyle =
  | 'action' | 'social' | 'romantic' | 'dramatic'
  | 'mystery' | 'stealth' | 'adventure' | 'mixed';
```

### 7.3 Runtime Encounter Shape

```typescript
interface Encounter {
  phases: Array<{
    id: string;
    situationImage?: string;
    beats: EncounterBeat[];
  }>;
  storylets?: {
    victory?: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat?: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };
}
```

The live runtime path uses `encounter.phases[].beats`. Legacy `encounter.beats` is only supported as a compatibility fallback.

### 7.4 Encounter Visual Contracts

Every setup beat, outcome, embedded next situation, and storylet beat can carry an `EncounterVisualContract` that locks:
- visual moment, primary action, emotional read
- relationship dynamic, must-show detail
- acting/body-language intent
- shot description and visual narrative

### 7.5 Partial Victory

`partialVictory` is a first-class outcome carrying a structured `EncounterCost`:

```typescript
interface EncounterCost {
  domain: EncounterCostDomain;
  severity: EncounterCostSeverity;
  bearer: EncounterCostBearer;
  immediateEffect: string;
  visibleComplication: string;
  lingeringEffect?: string;
  mechanicalConsequences?: Consequence[];
}
```

### 7.6 Dual Clock System

- **Goal Clock**: Player's objective progress (typically 6 segments)
- **Threat Clock**: Escalating danger (typically 4–6 segments)

---

## 8. Resolution Engine (Stat Checks)

The resolution engine (`src/engine/resolutionEngine.ts`) resolves stat checks without showing numbers.

### Resolution Tiers

| Tier | Player Experience |
|---|---|
| `success` | Empowerment, momentum |
| `complicated` | Tension, compromise |
| `failure` | Setback, new direction |

### Player Attributes

| Attribute | Description |
|---|---|
| `charm` | Social magnetism, persuasion |
| `wit` | Quick thinking, problem solving |
| `courage` | Bravery, facing danger |
| `empathy` | Understanding others, emotional intelligence |
| `resolve` | Determination, endurance |
| `resourcefulness` | Improvisation, creative solutions |

All attributes range 0–100, starting at 50 (from `CHARACTER_DEFAULTS` in `constants/pipeline.ts`).

---

## 9. Consequence System

### 9.1 Consequence Types

```typescript
type Consequence =
  | { type: 'attribute'; attribute: keyof PlayerAttributes; change: number }
  | { type: 'skill'; skill: string; change: number }
  | { type: 'relationship'; npcId: string; dimension: 'trust' | 'affection' | 'respect' | 'fear'; change: number }
  | { type: 'setFlag'; flag: string; value: boolean }
  | { type: 'changeScore'; score: string; change: number }
  | { type: 'setScore'; score: string; value: number }
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'addItem'; ... }
  | { type: 'removeItem'; itemId: string; quantity?: number }
```

### 9.2 Delayed Consequences (Butterfly Effect)

```typescript
interface DelayedConsequence {
  consequence: Consequence;
  description: string;
  delay?: { type: 'scenes' | 'episodes'; count: number; };
  triggerCondition?: ConditionExpression;
}
```

### 9.3 LLM Output Conversion

LLM agents output `StateChange` objects which are converted to runtime `Consequence` types via:
- `src/ai-agents/types/llm-output.ts` — canonical LLM output types
- `src/ai-agents/converters/stateChangeConverter.ts` — `convertStateChangeToConsequence`, `convertStateChangesToConsequences`

---

## 10. Identity Engine

The Identity Engine (`src/engine/identityEngine.ts`) aggregates player choices into a personality profile.

**Note:** `identityEngine` is NOT exported from the `src/engine/index.ts` barrel — it must be imported directly.

### Identity Dimensions

| Dimension | Negative Pole | Positive Pole | Range |
|---|---|---|---|
| `mercy_justice` | Merciful (-100) | Just (+100) | -100 to +100 |
| `idealism_pragmatism` | Idealist (-100) | Pragmatist (+100) | -100 to +100 |
| `cautious_bold` | Cautious (-100) | Bold (+100) | -100 to +100 |
| `loner_leader` | Lone Wolf (-100) | Natural Leader (+100) | -100 to +100 |
| `heart_head` | Heart-Driven (-100) | Analytical (+100) | -100 to +100 |
| `honest_deceptive` | Forthright (-100) | Cunning (+100) | -100 to +100 |

All start at 0 (via `DEFAULT_IDENTITY_PROFILE` in `src/types/index.ts`).

---

## 11. Condition Evaluation

The condition evaluator (`src/engine/conditionEvaluator.ts`) determines whether choices, scenes, and text variants are available.

### Condition Types

```typescript
type ConditionExpression =
  | { type: 'and'; conditions: ConditionExpression[] }
  | { type: 'or'; conditions: ConditionExpression[] }
  | { type: 'not'; condition: ConditionExpression }
  | { type: 'flag'; flag: string; value: boolean }
  | { type: 'score'; score: string; operator: ComparisonOperator; value: number }
  | { type: 'tag'; tag: string; hasTag: boolean }
  | { type: 'attribute'; attribute: keyof PlayerAttributes; operator: ComparisonOperator; value: number }
  | { type: 'skill'; skill: string; operator: ComparisonOperator; value: number }
  | { type: 'relationship'; npcId: string; dimension: RelationshipDimension; operator: ComparisonOperator; value: number }
  | { type: 'item'; itemId: string; hasItem?: boolean; has?: boolean; minQuantity?: number }
  | { type: 'identity'; dimension: keyof IdentityProfile; operator: ComparisonOperator; value: number }
```

The evaluator handles LLM-generated conditions that may lack an explicit `type` field by inferring from present fields.

---

## 12. Template Processing

The template processor (`src/engine/templateProcessor.ts`) handles dynamic text substitution.

| Template | Resolves To |
|---|---|
| `{{player.name}}` | Player's character name |
| `{{player.they}}` | Subject pronoun |
| `{{player.them}}` | Object pronoun |
| `{{player.their}}` | Possessive |
| `{{npc.NPCID.name}}` | NPC name |
| `{{score.SCORENAME}}` | Score value |
| `{{flag.FLAGNAME}}` | Flag value |

Includes verb conjugation for pronoun substitution and unresolved token fallback handling.

---

## 13. Validation Framework

### 13.1 Validators

| Validator | What It Checks |
|---|---|
| **ChoiceDistributionValidator** | Choice type percentages, branching cap, expression-no-branch |
| **ChoiceDensityValidator** | Choice timing and frequency |
| **ConsequenceBudgetValidator** | Consequence tier allocation |
| **FiveFactorValidator** | Five-factor impact (LLM-based) |
| **StakesTriangleValidator** | Want/Cost/Identity presence (LLM-based) |
| **BranchingValidator** | Maximum 2 branching choices, reconvergence |
| **RequiredNPCValidator** | Planned NPCs appear in scenes |
| **PlotValidator** | Character motivation consistency |
| **StructuralValidator** | Scene reachability and dead ends |
| **IncrementalValidators** | Per-scene voice / stakes / continuity / sensitivity / encounter structure |
| **storyAssetWalker** | **Tier 1 QA** — HTTP-verify every image URL in the assembled story |
| **storyPathAnalyzer** | Coverage planner — minimum choice paths to visit every scene/choice |
| **playwrightQARunner** | **Tier 2 QA** — spawns Playwright to play through every choice path in a real browser |
| **qaRemediation** | Re-generates broken/placeholder images and re-saves the story package/legacy mirror |

### 13.2 QA Agents (LLM-Based Validators)

| QA Agent | Expertise |
|---|---|
| **ContinuityChecker** | Character behavior, world rules, timeline |
| **VoiceValidator** | Character voice consistency |
| **StakesAnalyzer** | Stakes Triangle enforcement |
| **PlotHoleDetector** | Logic gaps, missed setup/payoff |
| **ToneAnalyzer** | Tone consistency across the episode |
| **PacingAuditor** | Narrative rhythm and flow |
| **SensitivityReviewer** | Content appropriateness |
| **CharacterArcTracker + ArcDeltaValidator** | Growth-arc legibility across blueprint → prose (replaces the former `BlueprintGrowthCritic` / `GrowthNarrativeCritic` pair) |

### 13.3 Two-Tier Final QA

After the LLM QA agents have produced their report and the story is assembled, the pipeline runs two deterministic QA passes that exercise the real artifacts:

**Tier 1 — Asset HTTP Verification (`storyAssetWalker.ts`)**

- Walks the assembled `Story` and collects every image URL (story/episode/scene covers, beats, panels, encounter phases/beats/outcomes/situations, storylets, NPC portraits).
- Issues a concurrent `HEAD` request (with ranged `GET` fallback) against each URL and classifies the result as `ok` / `missing` / `broken` / `unreachable`.
- Gate controlled by `ValidationConfig.assetHttpCheck` (default `true`) and `assetHttpCheckFailFast` (default `false`, warn-only).
- Also available standalone via `npm run validate:assets <story-dir>` for quick local verification.

**Tier 2 — Playwright Browser Playthrough (`playwrightQARunner.ts`)**

1. `storyPathAnalyzer.computeCoveragePlan()` builds a scene-level DAG from the generated story and picks the minimum set of choice paths that visit every scene and every choice at least once. It also marks which scenes need specific encounter tiers to be forced.
2. `runPlaywrightQAMultiPath()` spawns `test/e2e/storyPlaythrough.spec.ts` once per path (up to `maxParallel`, default `3`) against `http://localhost:8081`, passing the choice indices via the `E2E_CHOICE_PATH` env var.
3. Each run drives the real reader UI, recording broken/placeholder images, console errors, network failures, and a coverage report.
4. If any issue is fixable, `qaRemediation.remediateImageIssues()` parses the screen identifier, looks up the saved prompt under `prompts/`, re-calls the image service, patches the in-memory story, and `resaveFinalStory()` rewrites the story package/legacy mirror. Tier 2 then re-runs up to `playwrightQAMaxRetries` times (default `1`).
5. When the proxy or web app is not reachable, the runner marks itself `skipped` rather than failing the pipeline — so CLI generations don't require the UI.

---

## 14. State Management

### 14.1 React Context (gameStore)

```typescript
interface GameStore {
  // Story state
  story: GeneratedStory | null;
  currentEpisodeIndex: number;
  currentSceneIndex: number;
  currentBeatIndex: number;

  // Player state
  player: PlayerState;

  // Encounter state
  encounterState?: EncounterState;

  // Actions
  loadStory: (story: GeneratedStory) => void;
  makeChoice: (choiceId: string) => ChoiceResult;
  navigateToScene: (sceneId: string) => void;
}
```

### 14.2 Zustand Stores

| Store | Purpose |
|---|---|
| **settingsStore** | App configuration, API keys, generation settings |
| **appNavigationStore** | Screen navigation state |
| **generationJobStore** | Story generation job progress |
| **imageJobStore** | Image generation job progress |
| **videoJobStore** | Video generation job progress |
| **seasonPlanStore** | Season planning state |
| **imageFeedbackStore** | Image quality feedback |

### 14.3 AsyncStorage Persistence

| Key | Content |
|---|---|
| **playerStatePersistence** | Player attributes, relationships, inventory |
| **encounterStatePersistence** | Active encounter state |

---

## 15. Cross-Episode Continuity

### 15.1 Episode Summaries

Each completed episode generates a summary that feeds into the next episode's generation context.

### 15.2 Persistent State

- **Flags**: Boolean values that persist across episodes
- **Scores**: Numeric values for ongoing measurement
- **Tags**: Set membership for complex conditions
- **Relationships**: NPC relationship dimensions
- **Identity Profile**: Personality trait accumulation

### 15.3 Delayed Consequences

Consequences can be delayed across episode boundaries with triggers based on story progression.

---

## 16. Configuration Reference

### 16.1 AgentConfig

```typescript
interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}
```

### 16.2 GenerationSettingsConfig

```typescript
interface GenerationSettingsConfig {
  llmMaxGlobalInFlight?: number;
  llmMaxPerProviderInFlight?: number;
  failurePolicy?: 'fail_fast' | 'recover';
  // ... other settings
}
```

---

## 17. File Reference

### 17.1 Core Engine Files

- `src/engine/storyEngine.ts` — Main story runtime
- `src/engine/resolutionEngine.ts` — Stat check resolution
- `src/engine/conditionEvaluator.ts` — Choice/scene availability
- `src/engine/templateProcessor.ts` — Dynamic text substitution
- `src/engine/identityEngine.ts` — Personality tracking
- `src/engine/growthConsequenceBuilder.ts` — Character growth system

### 17.2 Agent Files

- `src/ai-agents/agents/BaseAgent.ts` — Base agent class
- `src/ai-agents/agents/StoryArchitect.ts` — Episode structure
- `src/ai-agents/agents/SceneWriter.ts` — Scene prose
- `src/ai-agents/agents/ChoiceAuthor.ts` — Player choices
- `src/ai-agents/agents/EncounterArchitect.ts` — Encounter design
- `src/ai-agents/agents/WorldBuilder.ts` — World building
- `src/ai-agents/agents/CharacterDesigner.ts` — NPC design
- `src/ai-agents/agents/ThreadPlanner.ts` — NarrativeThread ledger (setup/payoff, delayed consequences)
- `src/ai-agents/agents/TwistArchitect.ts` — Per-episode reversal + foreshadow scheduling
- `src/ai-agents/agents/CharacterArcTracker.ts` — Per-episode identity/relationship milestones
- `src/ai-agents/agents/StyleArchitect.ts` — Art-style string → ArtStyleProfile expansion
- `src/ai-agents/agents/SceneCritic.ts` — Optional per-scene pre-commit subtext/reversals review
- `src/ai-agents/agents/SeasonPlannerAgent.ts` — Season planning along the Story Circle spine

### 17.2.1 Validator & QA Files

- `src/ai-agents/validators/IncrementalValidators.ts` — Per-scene voice/stakes/continuity/sensitivity/encounter checks
- `src/ai-agents/validators/storyAssetWalker.ts` — Tier 1 asset HTTP verification
- `src/ai-agents/validators/storyPathAnalyzer.ts` — Coverage path planner for Tier 2
- `src/ai-agents/validators/playwrightQARunner.ts` — Tier 2 browser playthrough runner
- `src/ai-agents/validators/qaRemediation.ts` — Auto-remediation for Tier 2 image issues
- `test/e2e/storyPlaythrough.spec.ts` — The Playwright test that Tier 2 spawns

### 17.3 Pipeline Files

- `src/ai-agents/pipeline/FullStoryPipeline.ts` — Main generation pipeline
- `src/ai-agents/utils/concurrency.ts` — Parallelism utilities
- `src/ai-agents/utils/withTimeout.ts` — Timeout management
- `src/ai-agents/utils/pipelineTelemetry.ts` — Metrics collection

### 17.4 Store Files

- `src/stores/gameStore.ts` — Runtime game state
- `src/stores/settingsStore.ts` — App configuration
- `src/stores/generationJobStore.ts` — Generation progress
- `src/stores/playerStatePersistence.ts` — Player state persistence
- `src/stores/encounterStatePersistence.ts` — Encounter state persistence

### 17.5 Screen Files

- `src/screens/ReadingScreen.tsx` — Main story reading interface
- `src/screens/GeneratorScreen.tsx` — Story generation interface
- `src/screens/HomeScreen.tsx` — App home screen
- `src/screens/EpisodeSelectScreen.tsx` — Episode selection
- `src/screens/SettingsScreen.tsx` — App settings
- `src/screens/VisualizerScreen.tsx` — Story visualization
