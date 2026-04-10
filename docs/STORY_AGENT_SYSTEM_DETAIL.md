# StoryRPG: Complete System Architecture Document

**Last Updated:** December 2024

A comprehensive reference for the story agent structure, storytelling rules, branching mechanics, and choice determination systems.

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

The platform is built as a React Native/Expo app with LLM integration via Anthropic Claude and Google Gemini (with OpenAI as fallback).

### Architectural Layers

```
┌──────────────────────────────────────────────────────┐
│                    UI Layer                           │
│  ReadingScreen · GeneratorScreen · SettingsScreen     │
│  HomeScreen · EpisodeSelectScreen · VisualizerScreen  │
├──────────────────────────────────────────────────────┤
│                 State Layer                           │
│  gameStore (React Context) · settingsStore (Zustand)  │
│  appNavigationStore · generationJobStore             │
│  imageJobStore · videoJobStore · seasonPlanStore      │
│  imageFeedbackStore · AsyncStorage persistence        │
├──────────────────────────────────────────────────────┤
│                Engine Layer                           │
│  storyEngine · resolutionEngine · conditionEvaluator │
│  templateProcessor · identityEngine                  │
├──────────────────────────────────────────────────────┤
│              Generation Layer                         │
│  FullStoryPipeline · EpisodePipeline                 │
│  AI Agents · Validators · Prompts                    │
│  Image/Video Infrastructure · Converters             │
├──────────────────────────────────────────────────────┤
│                LLM Providers                         │
│  Anthropic Claude · Google Gemini · OpenAI (fallback)│
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
| **Scene Writer** | `SceneWriter.ts` | Prose content for beats, atmosphere, dialogue, text variants | 0.85 |
| **Beat Writer** | `BeatWriter.ts` | Beat-level content generation | 0.85 |
| **Choice Author** | `ChoiceAuthor.ts` | Player choices, consequences, stat checks, branching routing | 0.75 |
| **Branch Manager** | `BranchManager.ts` | Branch analysis, reconvergence validation, state tracking | 0.7 |
| **Encounter Architect** | `EncounterArchitect.ts` | Encounter structure, skill challenges, decision trees, storylets (phased execution via `executePhased`) | 0.75 |
| **Resolution Designer** | `ResolutionDesigner.ts` | Stat check design, difficulty calibration | 0.7 |
| **World Builder** | `WorldBuilder.ts` | World bible, locations, cultures, history | 0.8 |
| **Character Designer** | `CharacterDesigner.ts` | NPC profiles, want/fear/flaw, voice, relationships | 0.8 |
| **Dialogue Specialist** | `DialogueSpecialist.ts` | Dialogue variants per relationship state, emotional subtext | 0.85 |
| **Season Architect** | `SeasonArchitect.ts` | Season-level narrative arc planning | 0.7 |
| **Season Planner** | `SeasonPlannerAgent.ts` | Episode-by-episode plan within a season | 0.7 |
| **Source Material Analyzer** | `SourceMaterialAnalyzer.ts` | IP analysis for adapted properties | 0.6 |
| **Script Compiler** | `ScriptCompiler.ts` | Final script assembly | 0.5 |

#### QA and Analysis Agents

| Agent | File | Role |
|---|---|---|
| **QA Agents** | `QAAgents.ts` | `ContinuityChecker`, `VoiceValidator`, `StakesAnalyzer`, `QARunner` |
| **Extended QA** | `QAAgents.ts` | `PlotHoleDetector`, `ToneAnalyzer`, `PacingAuditor`, `SensitivityReviewer`, `ExtendedQARunner` |
| **Variable Tracker** | `VariableTracker.ts` | State variable tracking across scenes |
| **Playtest Simulator** | `PlaytestSimulator.ts` | Automated playtest simulation |

#### Growth Agents

| Agent | File | Role |
|---|---|---|
| **Blueprint Growth Critic** | `BlueprintGrowthCritic.ts` | Growth arc validation in episode blueprints |
| **Growth Narrative Critic** | `GrowthNarrativeCritic.ts` | Character growth validation in generated content |

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
| **Image Generator** | `ImageGenerator.ts` | Unified image prompt generation |

#### Image QA Validators

| Agent | File |
|---|---|
| **Consistency Scorer** | `image-team/ConsistencyScorerAgent.ts` |
| **Composition Validator** | `image-team/CompositionValidatorAgent.ts` |
| **Transition Validator** | `image-team/TransitionValidator.ts` |
| **Pose Diversity Validator** | `image-team/PoseDiversityValidator.ts` |
| **Expression Validator** | `image-team/ExpressionValidator.ts` |
| **Body Language Validator** | `image-team/BodyLanguageValidator.ts` |
| **Lighting Color Validator** | `image-team/LightingColorValidator.ts` |
| **Visual Narrative Validator** | `image-team/VisualNarrativeValidator.ts` |
| **Visual Storytelling Validator** | `image-team/VisualStorytellingValidator.ts` |
| **Drama Extraction Agent** | `image-team/DramaExtractionAgent.ts` |
| **Asset Auditor** | `image-team/AssetAuditorAgent.ts` |

#### Additional Support Agents

| Agent | File |
|---|---|---|
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

The `FullStoryPipeline` (`src/ai-agents/pipeline/FullStoryPipeline.ts`) orchestrates the complete story generation process:

```
1. Source Material Analysis (if adapting IP)
     ↓
2. World Building (World Builder → World Bible)
     ↓
3. Character Design (Character Designer → Character Profiles)
     ↓
4. Season Planning (Season Planner → Episode Plans)
     ↓
5. Per-Episode Generation:
   a. Story Architect → Episode Blueprint (scene graph)
   b. Scene Writer → Beat prose for each scene
   c. Choice Author → Choices for each choice point
   d. Encounter Architect → Encounter structure + storylets
   e. Branch Manager → Branch analysis + validation
   f. Incremental Validation → Per-scene quality checks
   g. Quick Validation → Best-practices checks
   h. QA Agents → Full quality validation
   i. Image Generation → Scene art, character images, encounter images
   j. Video Generation (optional) → Scene video via Veo
     ↓
6. Final Story Assembly + Output Writing
```

### 3.2 Episode Pipeline

Each episode goes through its own sub-pipeline:

1. **Blueprint Phase**: Story Architect creates the `EpisodeBlueprint` with branch structure, choice points, and encounter placement.
2. **Content Phase**: Scene Writer generates beat-level prose. Choice Author creates choices. Incremental validators check quality after each scene/choice.
3. **Encounter Phase**: Encounter Architect designs the encounter's internal structure — phases, approaches, decision trees, and storylets. Now supports phased execution via `executePhased` (runPhase1–runPhase4).
4. **Validation Phase**: Branch Manager validates branch structure. Various validators check types, percentages, budgets, and story principles.
5. **Image Phase**: Image agents generate scene art, character images, encounter images, and visual content.
6. **Video Phase** (optional): VideoDirectorAgent generates video direction, VideoGenerationService renders via Veo.

### 3.3 Pipeline Parallelism

- **Episode parallelism**: Multiple episodes can be generated concurrently (configurable via `maxParallelEpisodes`, default 2).
- **Scene parallelism**: Scenes within an episode can be generated in parallel (configurable via `maxParallelScenes`, default 2).
- **Dependency mode**: `sequential` preserves episode-to-episode summary dependency chains. `independent` allows full parallelism.
- **Concurrency utilities**: `AsyncSemaphore`, `mapWithConcurrency`, `LocalWorkerQueue` in `src/ai-agents/utils/concurrency.ts`.

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
| **StakesTriangleValidator** | Want/Cost/Identity stakes (LLM-based) |
| **BranchingValidator** | Branching structural integrity, reconvergence |
| **NPCRelationshipValidator** | NPC relationship dimension requirements |
| **PlayerAttributeValidator** | Attribute values within 0-100 bounds |
| **StateVariableValidator** | Flag/score/tag usage consistency |
| **TextLimitsValidator** | Word/character count enforcement |

### 13.2 Validation Pipeline

```
1. Type validation (structure checks)
     ↓
2. Percentage validation (distribution checks)
     ↓
3. Budget validation (consequence allocation)
     ↓
4. LLM validation (five-factor impact, stakes triangle)
     ↓
5. Best-practices validation (choice density, text limits)
```

---

## 14. State Management

### 14.1 Player State Structure

```typescript
interface PlayerState {
  // Core identity
  name: string;
  pronouns: 'he/him' | 'she/her' | 'they/them';

  // Attributes (0-100)
  attributes: {
    charm: number;
    wit: number;
    courage: number;
    empathy: number;
    resolve: number;
    resourcefulness: number;
  };

  // Skills (0-100)
  skills: { [skillName: string]: number };

  // NPC Relationships (each -100 to +100)
  relationships: {
    [npcId: string]: {
      trust: number;
      affection: number;
      respect: number;
      fear: number;
    };
  };

  // State tracking
  flags: { [key: string]: boolean };
  scores: { [key: string]: number };
  tags: Set<string>;

  // Inventory
  inventory: InventoryItem[];

  // Identity profile (-100 to +100 each)
  identityProfile: {
    mercy_justice: number;
    idealism_pragmatism: number;
    cautious_bold: number;
    loner_leader: number;
    heart_head: number;
    honest_deceptive: number;
  };

  // Session data
  currentEpisodeId: string;
  currentSceneId: string;
  currentBeatId?: string;
  visitedScenes: string[];
  completedEpisodes: string[];
}
```

### 14.2 State Persistence

- **AsyncStorage**: Local device storage for React Native
- **File system**: JSON files for Node.js
- **Game Store**: React Context provider (`gameStore`) for runtime state
- **Settings Store**: Zustand store (`settingsStore`) for app preferences

### 14.3 State Stores

| Store | Purpose | Location |
|---|---|---|
| `gameStore` | Player state, current episode/scene | `src/stores/gameStore.ts` |
| `settingsStore` | User preferences, generation settings | `src/stores/settingsStore.ts` |
| `generationJobStore` | Pipeline job tracking | `src/stores/generationJobStore.ts` |
| `imageJobStore` | Image generation jobs | `src/stores/imageJobStore.ts` |
| `videoJobStore` | Video generation jobs | `src/stores/videoJobStore.ts` |
| `seasonPlanStore` | Season planning data | `src/stores/seasonPlanStore.ts` |
| `imageFeedbackStore` | Image feedback/ratings | `src/stores/imageFeedbackStore.ts` |
| `appNavigationStore` | UI navigation state | `src/stores/appNavigationStore.ts` |

---

## 15. Cross-Episode Continuity

### 15.1 Episode Summaries

Each completed episode generates a summary that becomes input context for subsequent episodes, preserving:
- Key events and decisions
- Relationship changes
- Acquired items/knowledge
- Narrative threads

### 15.2 Persistent State Variables

| Type | Persistence |
|---|---|
| **Flags** | Cross-episode (permanent) |
| **Scores** | Cross-episode (cumulative) |
| **Tags** | Cross-episode (additive) |
| **Relationships** | Cross-episode (evolving) |
| **Inventory** | Cross-episode (carried forward) |
| **Identity** | Cross-episode (accumulating) |

### 15.3 Season Planning

Season-level planning via `SeasonPlannerAgent` ensures:
- Episode-to-episode narrative arcs
- Character development across episodes
- Branching consequences that span multiple episodes
- Encounter difficulty progression
- Relationship development curves

---

## 16. Configuration Reference

### 16.1 Generation Settings

```typescript
interface GenerationSettingsConfig {
  // Parallelism
  maxParallelEpisodes: number;      // Default: 2
  maxParallelScenes: number;        // Default: 2
  
  // LLM constraints
  llmMaxGlobalInFlight: number;     // Default: 4
  llmMaxPerProviderInFlight: number; // Default: 2
  
  // Quality controls
  strictValidation: boolean;        // Default: true
  failurePolicy: 'fail_fast' | 'recover'; // Default: 'fail_fast'
  
  // Content generation
  targetEpisodeCount: number;       // Default: 8
  targetSceneCount: number;         // Default: 12 per episode
  targetBeatCount: number;          // Default: 8 per scene
  
  // Images and video
  generateImages: boolean;          // Default: true
  generateVideo: boolean;           // Default: false
  
  // Memory (Claude only)
  useMemory: boolean;              // Default: false
}
```

### 16.2 Agent Configuration

```typescript
interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  apiKey: string;
  maxTokens: number;    // Default: 4096
  temperature: number;  // 0.0-1.0, varies by agent
}
```

### 16.3 Validation Thresholds

| Validator | Threshold | Configurable? |
|---|---|---|
| **Choice Density** | ≤120 seconds between choices | No |
| **Choice Distribution** | Expression 15-25%, Relationship 20-30%, Strategic 25-35%, Dilemma 20-30% | No |
| **Stakes Triangle** | ≥60/100 score | Yes (ChoiceAuthor constructor) |
| **Five Factor** | ≥1 impact factor | No |
| **Branching** | ≤2 per episode | No |

---

## 17. File Reference

### 17.1 Core Engine Files

| File | Purpose |
|---|---|
| `src/engine/storyEngine.ts` | Scene navigation, choice execution |
| `src/engine/resolutionEngine.ts` | Stat check resolution |
| `src/engine/conditionEvaluator.ts` | Choice/scene condition evaluation |
| `src/engine/templateProcessor.ts` | Text template substitution |
| `src/engine/identityEngine.ts` | Identity profile updates |

### 17.2 Key Agent Files

| File | Purpose |
|---|---|
| `src/ai-agents/agents/BaseAgent.ts` | Agent base class with LLM calls |
| `src/ai-agents/agents/StoryArchitect.ts` | Episode structure design |
| `src/ai-agents/agents/SceneWriter.ts` | Beat prose generation |
| `src/ai-agents/agents/ChoiceAuthor.ts` | Player choice creation |
| `src/ai-agents/agents/EncounterArchitect.ts` | Encounter design |

### 17.3 Pipeline Files

| File | Purpose |
|---|---|
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Master generation orchestrator |
| `src/ai-agents/utils/concurrency.ts` | Parallelism utilities |
| `src/ai-agents/utils/memoryStore.ts` | Pipeline memory abstraction |
| `src/ai-agents/utils/pipelineTelemetry.ts` | Metrics collection |

### 17.4 Validation Files

| File | Purpose |
|---|---|
| `src/ai-agents/validators/ChoiceDistributionValidator.ts` | Choice type percentages |
| `src/ai-agents/validators/ChoiceDensityValidator.ts` | Choice timing validation |
| `src/ai-agents/validators/FiveFactorValidator.ts` | LLM-based impact validation |
| `src/ai-agents/validators/StakesTriangleValidator.ts` | LLM-based stakes validation |

### 17.5 Type Definitions

| File | Purpose |
|---|---|
| `src/types/index.ts` | Core runtime types (Player, Scene, Choice, etc.) |
| `src/ai-agents/types/llm-output.ts` | LLM output types |
| `src/types/sourceAnalysis.ts` | Source material analysis types |

### 17.6 Constants and Configuration

| File | Purpose |
|---|---|
| `src/constants/pipeline.ts` | CHARACTER_DEFAULTS and pipeline constants |
| `src/constants/validation.ts` | TEXT_LIMITS and validation thresholds |
| `src/ai-agents/prompts/storytellingPrinciples.ts` | Core storytelling prompt |

This completes the comprehensive system architecture reference for StoryRPG. For specific implementation details, consult the individual source files and their inline documentation.