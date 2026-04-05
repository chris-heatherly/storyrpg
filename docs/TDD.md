# StoryRPG - Technical Design Document

**Version:** 3.0 (Comprehensive Reference Edition)  
**Last Updated:** February 26, 2026  
**Status:** Active Development

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture: Three Execution Zones](#3-architecture-three-execution-zones)
4. [Directory Structure](#4-directory-structure)
5. [Application Runtime (Client)](#5-application-runtime-client)
6. [Story Playback Engine](#6-story-playback-engine)
7. [Canonical Data Model](#7-canonical-data-model)
8. [State Management](#8-state-management)
9. [Proxy Server (Control Plane)](#9-proxy-server-control-plane)
10. [AI Agent Pipeline](#10-ai-agent-pipeline)
11. [Pipeline Orchestration Deep Dive](#11-pipeline-orchestration-deep-dive)
12. [Worker System](#12-worker-system)
13. [Validation Architecture](#13-validation-architecture)
14. [Image Generation System](#14-image-generation-system)
15. [Audio Generation System](#15-audio-generation-system)
16. [Resolution Engine](#16-resolution-engine)
17. [Identity Engine](#17-identity-engine)
18. [Condition Evaluator](#18-condition-evaluator)
19. [Template Processor](#19-template-processor)
20. [Persistence and Storage](#20-persistence-and-storage)
21. [Event and Telemetry System](#21-event-and-telemetry-system)
22. [Configuration System](#22-configuration-system)
23. [Error Handling and Recovery](#23-error-handling-and-recovery)
24. [Security and API Key Management](#24-security-and-api-key-management)
25. [Build and Deployment](#25-build-and-deployment)
26. [Constraints and Known Limitations](#26-constraints-and-known-limitations)

---

## 1) System Overview

StoryRPG is a local-first interactive fiction application built with React Native/Expo, backed by a Node.js/Express proxy server, and powered by a TypeScript AI agent generation pipeline. The system generates, validates, and plays back branching interactive stories with images and optional audio narration.

The architecture is designed around three core requirements:

1. **Long-running generation jobs** that may take 15-60+ minutes must survive failures, browser refreshes, and network interruptions.
2. **Fiction-first playback** must be smooth, responsive, and completely divorced from the generation complexity.
3. **Multiple AI providers** (Anthropic Claude for text, Gemini/Midjourney/Atlas Cloud for images, ElevenLabs for audio) must be abstracted behind consistent interfaces.

### High-Level Data Flow

```
[User Input] → [Proxy Server] → [Worker Process] → [AI Pipeline]
                                                        ↓
[Generated Story Files] ← [Pipeline Output Writer] ← [Validated Story]
        ↓
[Client App] → [Story Engine] → [Player Experience]
```

The user starts generation from the client app. The client calls the proxy server, which spawns a worker process. The worker executes the AI pipeline, which calls LLM APIs (Anthropic, OpenAI, Gemini), image generation APIs, and audio APIs. The pipeline validates and writes the resulting story to the filesystem. The client then reads the story files and plays them back through the story engine.

---

## 2) Technology Stack

### Frontend (Client Runtime)

| Technology | Version | Purpose |
|---|---|---|
| React | 19.1.0 | UI component framework |
| React Native | 0.81.5 | Cross-platform mobile framework |
| Expo | ~54.0.31 | React Native build tooling and dev server |
| React Native Web | ^0.21.0 | Web platform support for React Native components |
| Zustand | ^5.0.10 | Lightweight state management (for generation jobs) |
| AsyncStorage | ^2.2.0 | Client-side persistent key-value store |
| Lucide React Native | ^0.563.0 | Icon library |
| pdfjs-dist | ^3.11.174 | PDF parsing for source material upload |

### Backend (Proxy/Control Plane)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20.x | Server runtime |
| Express | ^5.2.1 | HTTP server framework |
| cors | ^2.8.5 | Cross-origin request handling |
| dotenv | ^17.2.3 | Environment variable loading |
| sharp | ^0.34.5 | Server-side image processing |

### Build and Development

| Technology | Version | Purpose |
|---|---|---|
| TypeScript | ~5.9.2 | Type-safe JavaScript |
| ts-node | ^10.9.2 | TypeScript execution for worker processes |
| tsconfig-paths | ^4.2.0 | Path alias resolution |
| babel-preset-expo | ^54.0.9 | Babel compilation for Expo |
| Metro | (bundled with Expo) | JavaScript bundler |

### External APIs

| Service | Purpose | Required? |
|---|---|---|
| Anthropic (Claude) | Primary LLM for text generation | Yes (for generation) |
| Google Gemini | Image generation (Nano-Banana provider) | Optional (default image provider) |
| Atlas Cloud | Alternative image generation | Optional |
| MidAPI (Midjourney) | Premium image generation | Optional |
| ElevenLabs | Voice narration and text-to-speech | Optional |
| catbox.moe | Public hosting for reference images (MidAPI requirement) | Only with MidAPI |

---

## 3) Architecture: Three Execution Zones

The system is partitioned into three execution zones that communicate through well-defined interfaces:

### Zone 1: Client Runtime

**What it is:** The React Native/Expo application that runs in the user's browser (web) or on their phone (iOS/Android).

**What it does:**
- Displays the story catalog and lets users select stories
- Plays back stories through the reading interface
- Provides the generation configuration and monitoring UI
- Manages player state (game progress, settings, identity)
- Polls the proxy for generation job updates

**What it does NOT do:**
- It does not call LLM APIs directly (all API calls go through the proxy)
- It does not write files to the filesystem (file writes go through proxy endpoints)
- It does not execute generation pipeline code (that runs in worker processes)

### Zone 2: Proxy/Control Plane

**What it is:** A Node.js/Express server running on `localhost:3001`.

**What it does:**
- Proxies all external API calls (Anthropic, ElevenLabs, MidAPI, Atlas Cloud) to avoid CORS restrictions and centralize error handling
- Manages the lifecycle of worker processes (start, monitor, cancel, clean up)
- Provides a filesystem API for reading/writing generated story files
- Maintains durable job state (generation jobs, worker checkpoints, dead letter queue)
- Serves generated images and audio files as static assets

**Key characteristic:** This is the "durability boundary" — if the client crashes or refreshes, the proxy still knows the state of all running jobs and can resume communication when the client reconnects.

### Zone 3: Pipeline Runtime

**What it is:** TypeScript code executed in child processes (workers) spawned by the proxy server.

**What it does:**
- Runs the full AI generation pipeline (world building, character design, story architecture, scene writing, etc.)
- Makes LLM API calls to Anthropic Claude (or OpenAI/Gemini)
- Makes image generation API calls
- Makes audio generation API calls
- Validates generated content
- Writes output artifacts (story JSON files, images, audio)

**Key characteristic:** Workers run as separate Node.js processes. They communicate with the proxy through structured events written to stdout, which the proxy captures and projects into its job tracking system.

### Communication Between Zones

```
Client ←→ Proxy:      HTTP REST endpoints + polling
Proxy  ←→ Worker:     Child process stdio (stdout events, stdin commands)
Worker ←→ AI APIs:    HTTPS calls (proxied through the proxy server for LLM,
                       direct for some image/audio services)
Proxy  ←→ Filesystem: Direct file I/O (JSON files, images, audio)
Client ←→ Filesystem: Via proxy HTTP endpoints only
```

---

## 4) Directory Structure

```
StoryRPG_New/
├── AGENTS.md                           # Agent orientation (workspace rule)
├── docs/                               # All project documentation
│   ├── GDD.md                          # Game Design Document
│   ├── TDD.md                          # Technical Design Document (this file)
│   ├── INSTALL.md                      # Installation Guide
│   ├── visual_storytelling_guide.md    # Visual direction reference
│   ├── visual_storytelling_quick_reference.md
│   └── reference/                      # Original reference materials
│
└── storyrpg-prototype/                 # Main application directory
    ├── App.tsx                         # Application entry point and screen router
    ├── index.ts                        # Expo app registration + polyfills
    ├── proxy-server.js                 # Express proxy server (~2500 lines)
    ├── package.json                    # Dependencies and scripts
    ├── tsconfig.json                   # TypeScript config (client)
    ├── tsconfig.worker.json            # TypeScript config (worker processes)
    ├── babel.config.js                 # Babel config with path aliases
    ├── metro.config.js                 # Metro bundler config
    ├── app.json                        # Expo app configuration
    ├── docker-compose.proxy.yml        # Docker config for proxy server
    ├── .env                            # Environment variables (API keys)
    │
    ├── src/
    │   ├── ai-agents/                  # AI Generation Pipeline (~97 files)
    │   │   ├── agents/                 # Individual AI agent classes
    │   │   │   ├── BaseAgent.ts        # Abstract base class for all agents
    │   │   │   ├── StoryArchitect.ts   # Episode blueprint design
    │   │   │   ├── WorldBuilder.ts     # World bible generation
    │   │   │   ├── CharacterDesigner.ts # NPC profile generation
    │   │   │   ├── SceneWriter.ts      # Beat/prose generation
    │   │   │   ├── ChoiceAuthor.ts     # Choice generation with consequences
    │   │   │   ├── EncounterArchitect.ts # Encounter design
    │   │   │   ├── BranchManager.ts    # Branch/reconvergence management
    │   │   │   ├── QAAgents.ts         # Quality assurance agents
    │   │   │   └── image-team/         # Image generation agents
    │   │   │       ├── CharacterReferenceSheetAgent.ts
    │   │   │       ├── StoryboardAgent.ts
    │   │   │       ├── VisualIllustratorAgent.ts
    │   │   │       └── EncounterImageAgent.ts
    │   │   │
    │   │   ├── pipeline/               # Pipeline orchestrators
    │   │   │   ├── FullStoryPipeline.ts # Main pipeline coordinator
    │   │   │   ├── EpisodePipeline.ts  # Per-episode generation
    │   │   │   └── phases/             # Phase-specific logic
    │   │   │
    │   │   ├── services/               # External service integrations
    │   │   │   ├── imageGenerationService.ts  # Multi-provider image service
    │   │   │   └── audioGenerationService.ts  # ElevenLabs audio service
    │   │   │
    │   │   ├── validators/             # Content validation
    │   │   │   ├── StructuralValidator.ts
    │   │   │   ├── IntegratedBestPracticesValidator.ts
    │   │   │   └── IncrementalValidationRunner.ts
    │   │   │
    │   │   ├── converters/             # Data format converters
    │   │   ├── prompts/                # LLM prompt templates
    │   │   ├── utils/                  # Pipeline utilities
    │   │   │   ├── pipelineOutputWriter.ts  # File output management
    │   │   │   ├── llmParsing.ts       # LLM response parsing
    │   │   │   └── concurrency.ts      # Concurrency management
    │   │   │
    │   │   ├── server/                 # Server-side execution
    │   │   │   └── worker-runner.ts    # Worker process entry point
    │   │   │
    │   │   ├── config.ts              # Pipeline configuration
    │   │   └── types/                  # Pipeline-specific types
    │   │
    │   ├── screens/                    # Application screens
    │   │   ├── HomeScreen.tsx          # Story catalog
    │   │   ├── EpisodeSelectScreen.tsx # Episode chooser
    │   │   ├── ReadingScreen.tsx       # Story playback
    │   │   ├── GeneratorScreen.tsx     # Generation workflow
    │   │   ├── SettingsScreen.tsx      # Preferences and management
    │   │   └── VisualizerScreen.tsx    # Story graph visualization
    │   │
    │   ├── components/                 # Reusable UI components
    │   │   ├── StoryReader.tsx         # Core reading interface (~2000 lines)
    │   │   ├── EncounterView.tsx       # Encounter playback
    │   │   ├── ChoiceButton.tsx        # Choice rendering
    │   │   ├── NarrativeText.tsx       # Text display with formatting
    │   │   ├── PipelineProgress.tsx    # Generation progress UI
    │   │   └── StoryBrowser.tsx        # Story catalog browser
    │   │
    │   ├── stores/                     # State management
    │   │   ├── gameStore.ts            # Player/game state (React Context)
    │   │   ├── settingsStore.ts        # User settings (React Context)
    │   │   ├── generationJobStore.ts   # Generation jobs (Zustand)
    │   │   ├── seasonPlanStore.ts      # Season plans (module store)
    │   │   ├── imageJobStore.ts        # Image job tracking
    │   │   └── imageFeedbackStore.ts   # Image quality feedback
    │   │
    │   ├── engine/                     # Game logic engine
    │   │   ├── storyEngine.ts          # Beat processing, choice filtering, routing
    │   │   ├── resolutionEngine.ts     # Fiction-first stat check resolution
    │   │   ├── identityEngine.ts       # Identity profile management
    │   │   ├── conditionEvaluator.ts   # Condition tree evaluation
    │   │   └── templateProcessor.ts    # Text template variable substitution
    │   │
    │   ├── services/                   # Client-side services
    │   │   ├── narrationService.ts     # Audio narration playback
    │   │   └── encounterMemoryService.ts # Encounter state persistence
    │   │
    │   ├── types/                      # TypeScript type definitions
    │   │   ├── index.ts                # Core types (~1300 lines)
    │   │   ├── seasonPlan.ts           # Season planning types
    │   │   ├── sourceAnalysis.ts       # Source analysis types
    │   │   └── validation.ts           # Validation types
    │   │
    │   ├── data/stories/               # Built-in story data
    │   │   ├── bladesOfValoria.ts
    │   │   ├── savageNightsInParadise.ts
    │   │   ├── shadowsOfRavenmoor.ts
    │   │   └── theVelvetJob.ts
    │   │
    │   ├── theme/                      # Visual theme constants
    │   ├── constants/                  # Application constants
    │   ├── config/                     # Runtime configuration
    │   │   └── endpoints.ts            # API endpoint resolution
    │   ├── visualizer/                 # Graph visualization components
    │   └── utils/                      # General utilities
    │
    ├── generated-stories/              # Output directory for generated stories
    │   └── {story-slug}_{timestamp}/   # Per-story output directory
    │       ├── 08-final-story.json     # The complete story data file
    │       ├── images/                 # Generated images
    │       ├── audio/                  # Generated audio files
    │       │   ├── {beatId}.mp3
    │       │   └── {beatId}.alignment.json
    │       └── prompts/                # Saved LLM prompts (debug)
    │
    ├── .ref-images/                    # Character reference images
    ├── .generation-jobs.json           # Persistent job tracking
    ├── .worker-jobs.json               # Worker job state
    ├── .worker-checkpoints.json        # Checkpoint data for resumability
    ├── .worker-dead-letter.json        # Failed job records
    └── .image-feedback.json            # User image quality feedback
```

---

## 5) Application Runtime (Client)

### Entry Point Flow

1. **`index.ts`** — Registers the root component with Expo. Applies Node.js polyfills (Buffer, process, crypto, stream) needed for some libraries to function in the browser/mobile environment.

2. **`App.tsx`** — The root React component. Sets up the provider hierarchy and manages screen navigation.

### Provider Hierarchy

```
ErrorBoundary
  └── SettingsProvider (React Context — font size, dev mode, etc.)
      └── GameProvider (React Context — player state, story progress, etc.)
          └── AppContent (screen switching logic)
```

### Navigation Model

The app uses state-based navigation (no URL router). A single state variable `currentScreen` determines which screen is displayed:

```typescript
type Screen = 'home' | 'episodes' | 'reading' | 'settings' | 'visualizer' | 'generator';
```

Navigation handlers:
- `handleStartStory(storyId)` → loads story → navigates to `episodes`
- `handleSelectEpisode(episodeId)` → navigates to `reading`
- `handleOpenSettings()` → navigates to `settings`
- `handleOpenGenerator(resumeJobId?)` → navigates to `generator`
- `handleOpenVisualizer(storyId)` → navigates to `visualizer`

### Story Catalog Loading

On app start, the story catalog is assembled from three sources:

1. **Built-in stories:** Four pre-authored stories bundled in the app code (`src/data/stories/`). On web platform, these are installed as physical files on the proxy server if not already present.

2. **Generated stories:** The client calls `GET /list-stories` on the proxy server to discover stories in the `generated-stories/` directory. Each story directory is scanned for `08-final-story.json`.

3. **AsyncStorage cache:** A fallback for cases where the proxy is unavailable. Previously loaded stories are cached in AsyncStorage.

### Web Runtime URL Rewriting

When running on the web platform, generated story assets (images, audio) are referenced as local file paths in the story JSON. The client rewrites these URLs to point to the current hostname's proxy server:

```
./images/scene1-beat1.png → http://localhost:3001/generated-stories/{dir}/images/scene1-beat1.png
```

This ensures portability across different network configurations.

---

## 6) Story Playback Engine

### Overview

The story playback engine (`src/engine/`) is responsible for transforming the raw story data model into the moment-by-moment player experience. It is entirely client-side and has no server dependencies during playback.

### storyEngine.ts

The main orchestrator. Key functions:

#### `processBeat(beat, player, story) → ProcessedBeat`

Takes a raw beat from the story data, evaluates it against the current player state, and produces a display-ready processed beat:

1. **Text selection:** Checks for text variants (conditional alternative text). If the beat has variants and the player meets a variant's condition, that variant's text is used instead of the default.
2. **Template processing:** Replaces template tokens (e.g., `{{characterName}}`, `{{he/she}}`) with actual values from the player state and story data.
3. **Unresolved token cleanup:** If the LLM generated a template token that the resolver doesn't recognize, it's replaced with the character name rather than showing raw `{{tokens}}` to the player.
4. **Empty text fallback:** If all processing results in empty text, a genre-appropriate placeholder is used.
5. **Choice processing:** Each choice is evaluated for conditions, locked state, and stat check visibility.
6. **Auto-advance detection:** If a beat has no visible choices (none defined, or all filtered out), it auto-advances to the next beat.

#### `executeChoice(choice, player) → ChoiceResult`

Processes a player's choice selection:

1. **Condition check:** Verifies the choice is still available (conditions might have changed since the beat was displayed).
2. **Stat check resolution:** If the choice has a stat check, runs it through the resolution engine to get a tier (success/complicated/failure).
3. **Outcome text selection:** If the choice has authored outcome texts, selects the appropriate one based on the resolution tier.
4. **Consequence collection:** Gathers immediate and delayed consequences.
5. **Routing determination:** Returns any next scene or beat routing information.

#### `getNextScene(episode, currentSceneId, player) → Scene`

The scene routing algorithm (described in GDD Section 5). Handles conditional routing, fallback chains, and sequential advancement with circular reference protection.

### resolutionEngine.ts

The fiction-first resolution system. When a choice has a stat check:

1. **Player stat calculation:** Combines the relevant attribute (0-100) with any applicable skill bonus.
2. **Hidden roll:** Generates a random number 0-100 (never shown to the player).
3. **Target calculation:** `target = difficulty - ((playerStat - 50) * 0.5)`. Higher player stats reduce the target needed.
4. **Tier determination:**
   - Roll ≤ target - 20 → **Success** (beat the target by a wide margin)
   - Roll ≤ target + 10 → **Complicated** (close to the target)
   - Roll > target + 10 → **Failure** (missed significantly)
5. **Narrative text:** Each tier has genre-appropriate narrative descriptions (per attribute). These are generic fallbacks; authored outcome texts from the choice take priority.

#### Encounter Weight Calculation

For encounter choices, the resolution uses a weighted probability system:

- **Base weights:** 40% success, 35% complicated, 25% failure
- **Stat modifier:** The player's relevant skill shifts weights by up to ±15%
- **Stat bonus:** Pre-encounter state payoffs (e.g., having an NPC's trust) can reduce difficulty

### identityEngine.ts

Manages the six-dimension identity profile:

- **Tint flag processing:** When consequences include a tint flag (e.g., `tint:mercy`), the engine looks up the corresponding identity shifts from a predefined mapping table. Tints cause 10-15 point shifts.
- **Tag inference:** When consequences include tags, the engine infers identity shifts from keyword matching. Tags cause 5-point shifts.
- **Dominant trait detection:** Dimensions with absolute values ≥ 25 are considered "dominant" and labeled with descriptive names ("merciful," "bold," "analytical," etc.).

### conditionEvaluator.ts

Evaluates condition trees. Supports:
- Simple conditions: attribute, skill, relationship, flag, score, tag, item, identity checks
- Compound conditions: AND (all must pass), OR (any must pass), NOT (must fail)
- All comparison operators: ==, !=, >, <, >=, <=

### templateProcessor.ts

Replaces template tokens in text strings with values from player state and story data:
- `{{characterName}}` → player's name
- `{{he/she/they}}` → pronoun based on player's pronoun setting
- `{{him/her/them}}` → objective pronoun
- Other story-specific templates

---

## 7) Canonical Data Model

The entire system (generation pipeline, runtime engine, persistence) shares a single canonical data model defined in `src/types/index.ts` (~1300 lines). This is critical: generation output must match the runtime's expected format exactly, with no transformation drift.

### Core Entity Hierarchy

```
Story
  ├── id, title, genre, synopsis, coverImage
  ├── initialState (starting attributes, skills, tags, inventory)
  ├── npcs[] (id, name, description, portrait, pronouns, initialRelationship)
  └── episodes[]
       ├── id, number, title, synopsis, coverImage
       ├── unlockConditions?
       ├── onComplete? (consequences)
       └── scenes[]
            ├── id, name, backgroundImage?, ambientSound?
            ├── conditions? (skip scene if not met)
            ├── fallbackSceneId?
            ├── leadsTo[] (conditional routing targets)
            ├── isBottleneck?, isConvergencePoint?, branchType?
            ├── encounter? (complex multi-beat encounter)
            └── beats[]
                 ├── id, text, textVariants?
                 ├── speaker?, speakerMood?
                 ├── image?, audio?
                 ├── conditions? (skip beat if not met)
                 ├── nextBeatId?, nextSceneId?
                 ├── onShow? (consequences on display)
                 ├── visualMoment?, primaryAction?, emotionalRead?
                 └── choices[]
                      ├── id, text, choiceType
                      ├── conditions?, showWhenLocked?, lockedText?
                      ├── statCheck? (attribute, skill, difficulty)
                      ├── consequences[], delayedConsequences[]
                      ├── outcomeTexts? (success, partial, failure)
                      ├── reactionText?, tintFlag?
                      └── nextSceneId?, nextBeatId?
```

### Player State Model

```
PlayerState
  ├── characterName, characterPronouns
  ├── attributes (charm, wit, courage, empathy, resolve, resourcefulness)
  ├── skills: Record<string, number>
  ├── relationships: Record<npcId, {trust, affection, respect, fear}>
  ├── flags: Record<string, boolean>
  ├── scores: Record<string, number>
  ├── tags: Set<string>
  ├── identityProfile (6 dimensions, -100 to +100)
  ├── pendingConsequences: DelayedConsequence[]
  ├── inventory: InventoryItem[]
  └── currentStoryId, currentEpisodeId, currentSceneId, completedEpisodes[]
```

### Encounter Model

Encounters have their own rich sub-model:

```
Encounter
  ├── id, type, name, description
  ├── goalClock (segments, filled, type)
  ├── threatClock (segments, filled, type)
  ├── stakes (victory description, defeat description)
  ├── pixarStakes (odds against, what player loses, obstacles)
  ├── informationVisibility (fog of war settings)
  ├── environmentalElements[] (hazards, opportunities)
  ├── npcStates[] (disposition, tells, reactions)
  ├── escalationTriggers[]
  ├── cameraEscalation (per-phase camera preferences)
  ├── initialVisualState
  ├── phases[]
  │    ├── beats[] (EncounterBeat)
  │    │    ├── setupText, setupTextVariants?
  │    │    ├── situationImage?
  │    │    ├── cinematicSetup (camera angle, shot type, mood, etc.)
  │    │    ├── escalationText? (when threat is high)
  │    │    └── choices[] (EncounterChoice)
  │    │         ├── text, approach, primarySkill
  │    │         ├── outcomes {success, complicated, failure}
  │    │         │    ├── tier, goalTicks, threatTicks
  │    │         │    ├── narrativeText, outcomeImage?
  │    │         │    ├── cinematicDescription
  │    │         │    ├── consequences?
  │    │         │    ├── nextSituation? (branching tree)
  │    │         │    │    ├── setupText, situationImage?
  │    │         │    │    └── choices[] (EmbeddedEncounterChoice)
  │    │         │    ├── isTerminal?, encounterOutcome?
  │    │         │    └── visualStateChanges?
  │    │         └── skillAdvantage?, conditions?
  │    └── onSuccess, onFailure (phase transitions)
  ├── outcomes {victory, partialVictory, defeat, escape}
  │    ├── nextSceneId, consequences, outcomeText
  │    └── complication? (partial), recoveryPath? (defeat)
  └── storylets? {victory, partialVictory, defeat, escape}
       └── GeneratedStorylet (beats[], consequences, nextSceneId)
```

### Consequence Types

The system supports 10 consequence types:

| Type | Description | Parameters |
|---|---|---|
| `attribute` | Change a core attribute | attribute, change (±) |
| `skill` | Change a skill value | skill name, change (±) |
| `relationship` | Change NPC relationship | npcId, dimension, change (±) |
| `setFlag` | Set a boolean flag | flag name, true/false |
| `changeScore` | Increment/decrement a score | score name, change (±) |
| `setScore` | Set a score to exact value | score name, value |
| `addTag` | Add an identity tag | tag name |
| `removeTag` | Remove an identity tag | tag name |
| `addItem` | Add item to inventory | item details, quantity |
| `removeItem` | Remove item from inventory | itemId, quantity |

### Condition Types

The system supports 8 atomic condition types plus 3 compound operators:

**Atomic:** attribute, skill, relationship, flag, score, tag, item, identity  
**Compound:** AND (all must pass), OR (any must pass), NOT (must fail)

---

## 8) State Management

### gameStore (React Context)

The primary game state store. Manages:

- **Active story and episode:** Which story and episode the player is currently in
- **Player state:** The complete `PlayerState` object (attributes, skills, relationships, flags, scores, tags, identity, inventory, pending consequences)
- **Encounter runtime:** Clock values, current phase/beat, approach selection, visual state
- **Branch tracking:** Which scenes the player has visited, convergence point awareness
- **Navigation state:** Current scene, current beat, scene history

**Persistence:** Serialized to AsyncStorage on every state change. On app restart, state is restored from AsyncStorage. Includes quota mitigation (pruning old data if storage is near capacity).

**Key operations:**
- `applyConsequences(consequences[])` — Apply immediate state changes
- `queueDelayedConsequence(consequence)` — Add to butterfly effect queue
- `checkAndFireDelayedConsequences()` — Check if any queued consequences should trigger
- `updateEncounterClocks(goalTicks, threatTicks)` — Update encounter momentum
- `updateIdentityProfile(consequences[])` — Apply identity shifts

### settingsStore (React Context)

Lightweight settings store:
- Font size (small, medium, large)
- Generation mode (single, multi, parallel)
- Developer mode toggle
- API key overrides

**Persistence:** AsyncStorage with key `@storyrpg_settings`.

### generationJobStore (Zustand)

Tracks generation jobs across the application:

- Job list with status (pending, running, completed, failed, cancelled)
- Active job progress (current phase, percentage, estimated time remaining)
- Job metadata (story title, episode count, generation config)

**Persistence:** Dual persistence:
- AsyncStorage for client-side cache
- Server sync via `GET/POST /generation-jobs` for durability across refreshes

**Key features:**
- Stale running detection: Jobs stuck in "running" state beyond a timeout are normalized to "failed"
- Auto cleanup: Old completed/failed jobs are pruned
- Heavy field pruning: Large payload fields are stripped before persisting to avoid quota issues

### seasonPlanStore (Module Store with Async Mutex)

Manages season plan data with atomic update semantics:
- Uses an async mutex to prevent concurrent writes from corrupting plan state
- Active plan pointer (which season plan is currently being worked on)
- Episode status tracking (planned, generating, completed)

**Persistence:** AsyncStorage with keys `season-plans` and `active-season-plan`. Implements progressive storage pruning when approaching quota limits.

---

## 9) Proxy Server (Control Plane)

### Overview

`proxy-server.js` is a ~2500-line Express server that serves as the central control plane. It handles four major responsibilities:

### 9.1 API Gateway

The proxy forwards API calls to external services, handling CORS, authentication, and error recovery:

| Endpoint | Target | Purpose |
|---|---|---|
| `POST /v1/messages` | Anthropic API | LLM text generation (Claude) |
| `ANY /midapi/*` | MidAPI | Midjourney image generation |
| `ANY /atlas-cloud-api/*` | Atlas Cloud | Atlas Cloud image generation |
| `ANY /elevenlabs/*` | ElevenLabs | Voice narration |

The Anthropic proxy includes special handling:
- Request/response logging in debug mode
- Timeout management (5-minute default)
- Error response normalization
- Rate limit header forwarding

### 9.2 Content Filesystem API

The proxy provides a filesystem API since the web client cannot directly access the local filesystem:

| Endpoint | Method | Purpose |
|---|---|---|
| `/list-stories` | GET | List all generated story directories with metadata |
| `/generated-stories/:dir/:path` | GET | Serve story assets (JSON, images, audio) |
| `/write-file` | POST | Write a file to the filesystem (used by generation) |
| `/delete-story` | POST | Delete a generated story directory |
| `/rename-story` | POST | Rename a story directory |
| `/install-builtin-story` | POST | Write a built-in story to the filesystem |
| `/check-builtin-stories` | GET | Check which built-in stories are installed |

### 9.3 Worker Job Management

The proxy manages the lifecycle of worker processes:

| Endpoint | Method | Purpose |
|---|---|---|
| `/worker-jobs/start` | POST | Start a new analysis or generation worker |
| `/worker-jobs/:jobId` | GET | Get worker job status and timeline |
| `/worker-jobs/:jobId/stream` | GET | Server-Sent Events for real-time progress |
| `/worker-jobs/:jobId/cancel` | POST | Cancel a running worker |
| `/worker-jobs/:jobId/export` | GET | Export worker timeline for diagnostics |

**Worker lifecycle management:**
1. Client calls `/worker-jobs/start` with mode (`analysis` or `generation`) and payload
2. Proxy persists job metadata to `.worker-jobs.json`
3. Proxy spawns `worker-runner.ts` as a child process using `ts-node`
4. Proxy captures worker's stdout events and updates timeline
5. Proxy monitors worker process health
6. On completion, proxy marks job as complete and records result path
7. On failure, proxy records the error in `.worker-dead-letter.json`

### 9.4 Generation Job Persistence

| Endpoint | Method | Purpose |
|---|---|---|
| `/generation-jobs` | GET | List all generation jobs |
| `/generation-jobs` | POST | Create/update a generation job |
| `/generation-jobs/:jobId` | DELETE | Remove a generation job |

Generation job state is persisted in `.generation-jobs.json` and survives server restarts.

### Reference Image Hosting

For image providers that require publicly accessible reference images (MidAPI/Midjourney), the proxy handles uploading reference images to catbox.moe:

| Endpoint | Method | Purpose |
|---|---|---|
| `/upload-ref-image` | POST | Upload a reference image to catbox.moe |
| `/.ref-images/:filename` | GET | Serve local reference images |

---

## 10) AI Agent Pipeline

### Agent Architecture

All AI agents inherit from `BaseAgent`, which provides:

- **LLM call abstraction:** Send prompts to Anthropic Claude (or OpenAI/Gemini) with consistent error handling
- **Retry logic:** Exponential backoff with configurable max retries
- **Circuit breaker:** Prevents retry storms when the API is consistently failing
- **Concurrency limiting:** Guards against exceeding per-provider rate limits
- **Response parsing:** JSON extraction from LLM responses (handles markdown code fences, partial JSON, etc.)
- **Logging:** Structured agent-level logging with event emission

### Agent Catalog

Each agent is a specialist responsible for one aspect of story generation:

| Agent | Input | Output | Purpose |
|---|---|---|---|
| **SourceMaterialAnalyzer** | Raw text/document | SourceMaterialAnalysis | Analyze source material for themes, characters, settings |
| **WorldBuilder** | Analysis + brief | World Bible | Create locations, factions, customs, world rules |
| **CharacterDesigner** | Analysis + world | Character Bible | Design NPCs with depth, voice, arcs |
| **StoryArchitect** | Episode plan + characters + world | Episode Blueprint | Design scene structure and encounter placement |
| **EncounterArchitect** | Blueprint + characters | Encounter structures | Design multi-beat encounter sequences |
| **SceneWriter** | Blueprint + characters + world | Scene beats/prose | Write narrative prose for each beat |
| **BeatWriter** | Scene outline + characters | Individual beats | Write specific beat content |
| **ChoiceAuthor** | Scenes + characters | Choices with consequences | Create choices with conditions, outcomes, routing |
| **BranchManager** | Scene graph | Branch/convergence plan | Plan branching and reconvergence |
| **QAAgents** | Generated content | Quality reports | Validate content quality |
| **CharacterReferenceSheetAgent** | Character descriptions | Reference images | Generate consistent character appearance references |
| **StoryboardAgent** | Scene descriptions | Storyboard plans | Plan visual sequence for scenes |
| **VisualIllustratorAgent** | Beat descriptions + refs | Beat images | Generate per-beat illustrations |
| **EncounterImageAgent** | Encounter descriptions + refs | Encounter images | Generate encounter-specific visuals |

### LLM Communication

Agents communicate with LLMs through structured prompts:

1. **System prompt:** Establishes the agent's role, constraints, and output format
2. **User prompt:** Provides the specific task with all necessary context (world data, character data, outline, etc.)
3. **Response parsing:** The LLM response is parsed as JSON. The parser handles:
   - Responses wrapped in markdown code fences (` ```json ... ``` `)
   - Partial JSON (truncated responses)
   - Non-JSON preamble text before the JSON payload
   - Malformed JSON with common LLM mistakes (trailing commas, etc.)

### Temperature Settings

Different agents use different LLM temperatures to balance creativity vs. consistency:

| Agent Type | Temperature | Rationale |
|---|---|---|
| StoryArchitect | 0.7 | More focused for structural/planning work |
| SceneWriter | 0.85 | More creative for prose writing |
| ChoiceAuthor | 0.75 | Balanced for meaningful choice creation |
| Default | 0.8 | General purpose |

---

## 11) Pipeline Orchestration Deep Dive

### FullStoryPipeline

The `FullStoryPipeline` is the top-level coordinator. It:

1. Loads configuration and initializes all agents
2. Sequences execution phases
3. Emits progress events for the worker/proxy/client chain
4. Handles cancellation checks between phases
5. Manages output directory creation and artifact writing
6. Coordinates validation runs

### Execution Modes

#### Analysis Mode

1. Receive source text/document + configuration
2. Run `SourceMaterialAnalyzer` to produce structured analysis
3. Run season planning to produce a `SeasonBible` with episode outlines
4. Write analysis result to disk
5. Return analysis payload to client for review

#### Generation Mode (Single Episode)

1. Receive generation brief (episode plan + config + analysis)
2. Resolve all generation options (scene counts, choice distributions, image/audio toggles)
3. **Phase 1 — Foundation:** Run `WorldBuilder` and `CharacterDesigner`
4. **Phase 2 — Architecture:** Run `StoryArchitect` to create episode blueprint
5. **Phase 3 — Content:** Run `SceneWriter` + `ChoiceAuthor` + `EncounterArchitect` for each scene
6. **Phase 4 — Assembly:** Convert generated fragments into canonical `Story` model
7. **Phase 5 — Structural Validation:** Run `StructuralValidator` with auto-fix for common defects
8. **Phase 6 — Quality Validation:** Run `IntegratedBestPracticesValidator` (quick + full modes)
9. **Phase 7 — Media:** Run image generation pipeline, then optional audio generation
10. **Phase 8 — Persistence:** Write final story JSON, prompts, diagnostics, manifests

#### Generation Mode (Multi-Episode)

Wraps single-episode generation in a loop, passing previous-episode summaries to maintain continuity across episodes.

#### Parallel Generation (Experimental)

`ParallelStoryPipeline` supports several parallelism strategies:

| Strategy | Description | Status |
|---|---|---|
| Episode | Generate multiple episodes concurrently | Partially implemented |
| Branch | Generate divergent branches in parallel | Partially implemented |
| Agent | Run independent agents in parallel within a phase | Limited/fallback |
| Hybrid | Combine strategies | Partially implemented |

Some strategies currently delegate to sequential internals when strict parallel independence cannot be guaranteed.

### EpisodePipeline

The inner pipeline for generating a single episode:

1. **Foundation phase:** `StoryArchitect` creates the episode blueprint
2. **Content phase:** Scene-by-scene generation with `SceneWriter` and `ChoiceAuthor`
3. **Validation phase:** Integrated best-practices + distribution checks
4. **Assembly phase:** Compile fragments into canonical `Episode` structure
5. **Dead-end prevention:** Detect and fix scenes with no outgoing paths
6. **Choice coverage check:** Ensure minimum choice density is met; add fallback choices if needed

---

## 12) Worker System

### Worker Entry Point: worker-runner.ts

Workers are spawned by the proxy server as child processes:

```
proxy-server.js → child_process.spawn('npx', ['ts-node', '--project', 'tsconfig.worker.json', 'worker-runner.ts'])
```

The worker receives its configuration as a JSON payload on stdin.

### Worker Input Payload

```typescript
{
  mode: 'analysis' | 'generation';
  config: PipelineConfig;
  resultPath: string;          // Where to write the final output
  // Mode-specific fields:
  sourceText?: string;         // For analysis mode
  brief?: GenerationBrief;     // For generation mode
  checkpoint?: WorkerCheckpoint; // For resuming
}
```

### Worker Event Protocol

Workers communicate with the proxy through structured JSON events written to stdout:

```
{"type": "worker_start", "timestamp": "...", "mode": "generation"}
{"type": "phase_start", "phase": "world_building", "timestamp": "..."}
{"type": "agent_start", "agent": "WorldBuilder", "timestamp": "..."}
{"type": "agent_complete", "agent": "WorldBuilder", "duration_ms": 12345}
{"type": "phase_complete", "phase": "world_building"}
{"type": "checkpoint", "data": {...}}
{"type": "worker_complete", "resultPath": "...", "timestamp": "..."}
```

The proxy captures these events line by line and:
- Appends them to the worker job's timeline
- Updates checkpoint data
- Mirrors status to the generation job store
- Broadcasts to any connected SSE clients

### Worker Lifecycle States

```
pending → running → complete
                  → failed (error or crash)
                  → cancelled (user-initiated)
```

### Checkpoint and Resume

At key points during generation, the worker emits checkpoint events containing serialized pipeline state. If the worker crashes or is cancelled, a new worker can be started with the checkpoint to skip already-completed phases.

### Dead Letter Queue

When a worker exits uncleanly (crash, timeout, OOM), the proxy records the failure in `.worker-dead-letter.json` with:
- Job ID
- Last known checkpoint
- Error information
- Timeline up to failure point

This supports post-failure diagnostics.

---

## 13) Validation Architecture

### Structural Validation

`StructuralValidator` performs mechanical integrity checks:

- **ID uniqueness:** All IDs across episodes, scenes, beats, choices are unique
- **Reference validity:** Every `nextSceneId`, `nextBeatId`, `leadsTo` target, and `fallbackSceneId` points to an existing entity
- **Navigation completeness:** No dead-end scenes (every scene has a way forward)
- **No infinite loops:** Scene routing doesn't create circular paths
- **Encounter integrity:** Phases connect properly, outcomes reference valid scenes, clocks are properly initialized
- **Text sanity:** No empty text fields, text within word count limits, no unresolved template tokens

The structural validator includes **auto-fix** capabilities for common defects:
- Missing `startingBeatId` → set to first beat
- Missing `startingSceneId` → set to first scene
- Orphaned beats → removed or reconnected
- Missing `leadsTo` entries → auto-generated based on scene order

### Best-Practices Validation

`IntegratedBestPracticesValidator` checks narrative quality:

| Check | What It Validates | Severity |
|---|---|---|
| **Choice Density** | First choice within ~60s of reading, average gap ≤ 90s | Warning |
| **NPC Depth** | Core NPCs have 4 relationship dimensions, supporting have 2+ | Warning |
| **Consequence Budget** | Balanced mix of callbacks, tints, branchlets, branches | Warning |
| **Stakes Triangle** | Each episode has emotional, practical, and relationship stakes | Error |
| **Five-Factor Impact** | Major choices impact ≥ 3 of 5 factors (outcome, process, info, relationships, identity) | Error |
| **Callback Coverage** | Delayed consequences are scheduled and reachable | Warning |

Validation runs in two modes:
- **Quick mode:** Fast blocking checks only. Used during generation to catch critical issues.
- **Full mode:** Comprehensive metrics with categorized issue reports. Used at the end of generation.

### Incremental Validation

`IncrementalValidationRunner` runs validation checks progressively during generation, rather than waiting until the end. This catches problems earlier when they're cheaper to fix.

---

## 14) Image Generation System

### ImageGenerationService

A multi-provider abstraction layer located at `src/ai-agents/services/imageGenerationService.ts`.

### Supported Providers

#### Nano-Banana (Gemini)
- **API:** Google Gemini API (models: `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`)
- **Features:**
  - Character reference images for consistency (up to 4 per character)
  - Previous scene image passing for visual continuity
  - Style reference images for style consistency
  - Edit mode (modify previous image instead of fresh generation)
  - Chat mode (multi-turn session retains visual context)
  - Configurable resolution (512px, 1K, 2K, 4K)
  - Configurable thinking level (minimal, high)

#### Atlas Cloud
- **API:** Atlas Cloud API (proxied through `/atlas-cloud-api`)
- **Features:** Custom model selection, standard image generation

#### MidAPI (Midjourney)
- **API:** MidAPI service (proxied through `/midapi`)
- **Features:**
  - Style reference codes (`--sref`) for consistent aesthetic
  - Omni reference (`--oref`) for character consistency using reference images
  - Configurable stylization and omni weights
  - Async generation with webhook callbacks
  - Requires reference images to be publicly accessible (uploaded to catbox.moe)

### Image Generation Flow

1. **Prompt construction:** The pipeline builds a detailed image prompt including scene description, character positions, camera angle, mood, lighting, and style directives.
2. **Reference resolution:** Character reference images are resolved and attached to the request.
3. **Concurrency control:** Maximum 3 concurrent image generation requests, with 3-second minimum between requests.
4. **Provider dispatch:** The request is routed to the configured provider.
5. **Retry logic:** Failed requests are retried with exponential backoff.
6. **Text detection:** Generated images are checked for unwanted text artifacts. Images with text may be rejected and regenerated (unless the beat explicitly allows diegetic text).
7. **Caching:** Prompt hashes are tracked to avoid regenerating identical images.
8. **Output:** Images are saved to `generated-stories/{dir}/images/` with beat-derived filenames.

### Character Reference System

For visual consistency, the pipeline generates character reference sheets before scene images:

1. `CharacterReferenceSheetAgent` creates prompts for multi-angle character views
2. Reference images are generated at higher resolution (2K default)
3. Individual views (front, 3/4, profile) are generated for each major character
4. These reference images are passed alongside scene prompts to maintain character appearance

---

## 15) Audio Generation System

### AudioGenerationService

Located at `src/ai-agents/services/audioGenerationService.ts`.

### ElevenLabs Integration

- **Text-to-Speech:** Converts beat text to spoken audio
- **Word alignment:** Returns timestamp data for each word, enabling karaoke-style highlighting
- **Character voices:** Voice casting service assigns distinct ElevenLabs voice IDs to different characters
- **Default voices:** Narrator, male, female, child voices available
- **Batch generation:** Can generate audio for an entire story in one pass

### Audio Storage

- MP3 files: `generated-stories/{dir}/audio/{beatId}.mp3`
- Alignment data: `generated-stories/{dir}/audio/{beatId}.alignment.json`
- Served via proxy: `GET /generated-stories/{dir}/audio/{beatId}.mp3`

### Client-Side Playback

`narrationService.ts` manages audio playback:
- Play/pause controls
- Word-by-word highlighting using alignment data
- Graceful fallback if audio is unavailable

---

## 16) Resolution Engine

Detailed in Section 6 under `resolutionEngine.ts`. Key technical details:

### Standard Resolution (Non-Encounter Choices)

```
playerStat = attribute[check.attribute] (or 50 if none)
playerStat = min(100, playerStat + skills[check.skill])
roll = random(0, 100)
statModifier = (playerStat - 50) * 0.5  // Range: -25 to +25
target = difficulty - statModifier

if (roll <= target - 20) → success
else if (roll <= target + 10) → complicated
else → failure
```

### Encounter Resolution (Weighted Probability)

```
BASE = { success: 0.40, complicated: 0.35, failure: 0.25 }
modifier = ((playerStat - 50) / 50) * 0.15  // Range: -0.15 to +0.15

success = clamp(BASE.success + modifier, 0.10, 0.65)
failure = clamp(BASE.failure - modifier, 0.05, 0.50)
complicated = 1.0 - success - failure

// Roll against these weights to determine outcome tier
```

---

## 17) Identity Engine

Detailed in Section 6 under `identityEngine.ts`. Key technical details:

### Tint Flag Mapping (examples)

```
'tint:mercy'      → mercy_justice: -15
'tint:justice'     → mercy_justice: +15
'tint:boldness'    → cautious_bold: +15
'tint:compassion'  → mercy_justice: -10, heart_head: -10
'tint:leadership'  → loner_leader: +15
'tint:deception'   → honest_deceptive: +15
```

### Tag Keyword Inference (examples)

```
Tag contains 'brave'/'bold'   → cautious_bold: +5
Tag contains 'kind'/'gentle'  → mercy_justice: -5, heart_head: -5
Tag contains 'honest'         → honest_deceptive: -5
Tag contains 'leader'         → loner_leader: +5
```

### Dominant Trait Threshold

A dimension value |value| >= 25 qualifies as a dominant trait. Labels:
- mercy_justice ≤ -25 → "merciful" | ≥ 25 → "just"
- idealism_pragmatism ≤ -25 → "idealist" | ≥ 25 → "pragmatist"
- cautious_bold ≤ -25 → "cautious" | ≥ 25 → "bold"
- loner_leader ≤ -25 → "lone wolf" | ≥ 25 → "natural leader"
- heart_head ≤ -25 → "heart-driven" | ≥ 25 → "analytical"
- honest_deceptive ≤ -25 → "forthright" | ≥ 25 → "cunning"

---

## 18) Condition Evaluator

The condition evaluator processes a tree of conditions recursively.

### Evaluation Logic

```
evaluate(condition, playerState):
  switch condition.type:
    'attribute' → compare player.attributes[condition.attribute] with condition.value
    'skill'     → compare player.skills[condition.skill] with condition.value
    'relationship' → compare player.relationships[npcId][dimension] with value
    'flag'      → player.flags[condition.flag] === condition.value
    'score'     → compare player.scores[condition.score] with condition.value
    'tag'       → player.tags.has(condition.tag) === condition.hasTag
    'item'      → check if player has item with optional quantity check
    'identity'  → compare player.identityProfile[dimension] with value
    'and'       → all sub-conditions must pass
    'or'        → any sub-condition must pass
    'not'       → sub-condition must fail
```

Comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`

---

## 19) Template Processor

Replaces template tokens in story text with runtime values.

### Token Resolution

The template processor handles:
- Character name: `{{characterName}}` → player's chosen name
- Pronouns: `{{he/she/they}}`, `{{him/her/them}}`, `{{his/her/their}}`, `{{himself/herself/themselves}}`
- NPC names: `{{npc:npcId}}` → NPC's display name
- Flag values: `{{flag:flagName}}` → flag's value
- Score values: `{{score:scoreName}}` → score's value

### Text Variant Selection

When a beat has `textVariants`, the engine evaluates each variant's condition in order. The first variant whose condition passes replaces the beat's default text. This allows the same beat to display different prose based on player state.

### Unresolved Token Handling

If an LLM generated a template token the resolver doesn't know (e.g., `{{mysterious_variable}}`), the engine:
1. Logs a warning with the token name
2. Replaces the token with the character's name (safe fallback)
3. Increments an observability counter for monitoring

---

## 20) Persistence and Storage

### Client-Side (AsyncStorage)

| Key | Content | Purpose |
|---|---|---|
| `gameStore_playerState` | Serialized PlayerState JSON | Save/resume game progress |
| `@storyrpg_settings` | Settings JSON | User preferences |
| `@storyrpg_generation_jobs` | Generation job list JSON | Job tracking |
| `season-plans` | Season plan data | Season planning |
| `active-season-plan` | Active plan ID | Season workflow |
| `@storyrpg_generated_stories` | Story metadata cache | Offline story catalog |
| `@storyrpg_deleted_stories` | Deleted story IDs | Prevent re-installing deleted built-ins |
| `@storyrpg_openrouter_api_key` | API key | User-provided API key |
| `@storyrpg_gemini_api_key` | API key | User-provided image API key |

**Storage quota management:** Stores implement progressive pruning strategies. When writes fail with quota errors, stores remove oldest/least-important data to free space.

### Server-Side (Filesystem)

| File | Content | Purpose |
|---|---|---|
| `.generation-jobs.json` | Job definitions and status | Durable job tracking |
| `.worker-jobs.json` | Worker process metadata | Worker lifecycle tracking |
| `.worker-checkpoints.json` | Checkpoint serializations | Resume support |
| `.worker-dead-letter.json` | Failed job records | Post-failure diagnostics |
| `.image-feedback.json` | User feedback on images | Quality iteration |
| `generated-stories/*/08-final-story.json` | Complete story data | Story content |
| `generated-stories/*/images/*.png` | Generated images | Visual assets |
| `generated-stories/*/audio/*.mp3` | Generated audio | Voice narration |
| `generated-stories/*/prompts/*.txt` | Saved LLM prompts | Debug/audit trail |

### Artifact Writing

Output writing is treated as a first-class pipeline phase, not an afterthought. `pipelineOutputWriter.ts` handles:

- Creating output directories with slugified names and timestamps
- Writing intermediate artifacts (world bible, character bible, blueprints)
- Writing the final story JSON as `08-final-story.json`
- Writing prompt logs for debugging
- Writing validation reports
- Atomic write operations (write to temp, rename to final)

---

## 21) Event and Telemetry System

### Pipeline Events

The pipeline emits structured `PipelineEvent` objects throughout execution:

| Event Type | When | Content |
|---|---|---|
| `phase_start` | A major pipeline phase begins | Phase name, description |
| `phase_complete` | A pipeline phase finishes | Phase name, duration |
| `agent_start` | An AI agent begins work | Agent name |
| `agent_complete` | An AI agent finishes | Agent name, duration, output summary |
| `incremental_validation` | Per-scene validation runs | Scene ID, issues found |
| `validation_aggregated` | Full validation completes | Summary metrics |
| `warning` | Non-fatal issue detected | Warning message and context |
| `debug` | Debug information | Arbitrary debug data |
| `error` | Fatal or near-fatal error | Error details |
| `checkpoint` | Checkpoint data saved | Serialized pipeline state |

### Event Flow

```
Pipeline → emits PipelineEvent
  → Worker captures and wraps as WorkerEvent
    → Worker writes JSON to stdout
      → Proxy captures stdout line
        → Proxy updates worker job timeline
          → Proxy updates generation job state
            → Client polls or receives SSE
              → UI updates progress bars
```

### Observability Metrics

The system tracks:
- LLM call counts and durations per agent
- Image generation cache hit/miss rates
- Retry counts per provider
- Validation issue counts by category
- Unresolved template token counts
- Worker process lifecycle events

---

## 22) Configuration System

### Environment Variables

The primary configuration mechanism is environment variables in the `.env` file:

#### Required for Story Generation

```env
ANTHROPIC_API_KEY=sk-ant-...       # Anthropic Claude API key
```

#### Image Generation (at least one if images enabled)

```env
EXPO_PUBLIC_GEMINI_API_KEY=...     # Google Gemini API key (for Nano-Banana)
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana  # Image provider selection
EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true
```

Alternative image providers:
```env
ATLAS_CLOUD_API_KEY=...            # Atlas Cloud provider
MIDAPI_TOKEN=...                   # MidAPI (Midjourney) provider
```

#### Audio Generation (Optional)

```env
ELEVENLABS_API_KEY=...             # ElevenLabs TTS
```

#### Optional Configuration

```env
PORT=3001                          # Proxy server port
EXPO_PUBLIC_LLM_MODEL=claude-sonnet-4-6  # LLM model selection
EXPO_PUBLIC_LLM_PROVIDER=anthropic # LLM provider
EXPO_PUBLIC_DEBUG=true             # Enable debug logging
EXPO_PUBLIC_VALIDATION_MODE=advisory  # Validation mode: strict/advisory/disabled
PROXY_PUBLIC_URL=https://...       # Public URL for webhook callbacks (ngrok)
```

### PipelineConfig

The `loadConfig()` function in `src/ai-agents/config.ts` loads environment variables and constructs a `PipelineConfig` object that controls all pipeline behavior:

- Agent configurations (provider, model, API key, max tokens, temperature)
- Validation configuration (which rules are enabled, severity levels, thresholds)
- Image generation configuration (provider, API key, strategy, provider-specific tuning)
- Output directory
- Debug mode flag

### GenerationSettingsConfig

Fine-grained generation tuning available through the settings UI:

- Scene structure: max scenes per episode, beat counts per scene type
- Choice distribution targets (% expression, relationship, strategic, dilemma)
- Branching cap: maximum branching choices per episode
- Text length limits: max words per beat, max choice words, max dialogue
- Encounter configuration: minimum encounters per episode by length
- Validation thresholds: choice density, blocking threshold, warning threshold
- Concurrency settings: parallel episodes, parallel scenes, max LLM calls in flight
- Image settings: provider-specific tuning (Gemini resolution, Midjourney stylization, etc.)

---

## 23) Error Handling and Recovery

### LLM Call Failures

| Failure Type | Recovery Strategy |
|---|---|
| Network timeout | Retry with exponential backoff (3 retries, 1s/2s/4s) |
| Rate limit (429) | Wait for `Retry-After` header, then retry |
| Server error (5xx) | Retry with backoff |
| Invalid response (no JSON) | Re-parse with fallback strategies, then retry |
| Circuit breaker open | Fail fast for 30 seconds, then retry |

### Image Generation Failures

| Failure Type | Recovery Strategy |
|---|---|
| Generation timeout | Retry (up to 3 times) |
| Content policy rejection | Skip image, use placeholder |
| Provider unavailable | Fall back to placeholder generation |
| Text in generated image | Regenerate with stronger no-text instruction |

### Worker Failures

| Failure Type | Recovery Strategy |
|---|---|
| Worker process crash | Record in dead letter queue; user can retry |
| Worker timeout | Kill process, mark job as failed |
| Out of memory | Kill process, mark job as failed |
| Checkpoint available | User can resume from last checkpoint |

### Storage Quota Failures

| Failure Type | Recovery Strategy |
|---|---|
| AsyncStorage quota exceeded | Progressive pruning of oldest data |
| Filesystem write failure | Log error, attempt write to alternative path |

---

## 24) Security and API Key Management

### API Key Storage

- API keys are stored in the `.env` file (server-side only for Anthropic)
- Client-accessible keys use the `EXPO_PUBLIC_` prefix (visible in browser, for Gemini image gen)
- Users can override API keys in the settings screen (stored in AsyncStorage)

### Proxy Security

- The proxy server runs on localhost only (not exposed to the internet by default)
- All external API calls are proxied through the local server
- No authentication on the proxy itself (local-only access model)
- Docker deployment option for isolated execution

### Important Security Notes

- The `.env` file should never be committed to version control
- `EXPO_PUBLIC_` prefixed keys are embedded in the client bundle and visible in browser dev tools
- For production deployment, API keys should be managed through a proper secrets management system

---

## 25) Build and Deployment

### Development Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | Kill existing node, start proxy + web | Full development environment |
| `npm run proxy` | `node proxy-server.js` | Start proxy server only |
| `npm run web` | `expo start --web` | Start Expo web dev server |
| `npm start` | `expo start` | Start Expo with platform choice |
| `npm run android` | `expo start --android` | Start Android dev server |
| `npm run ios` | `expo start --ios` | Start iOS dev server |

### Generation Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm run generate` | `ts-node src/ai-agents/example-usage.ts` | CLI story generation |
| `npm run generate:heist` | Same with `STORY_TYPE=heist` | Generate heist story |
| `npm run generate:fantasy` | Same with `STORY_TYPE=fantasy` | Generate fantasy story |
| `npm run generate:doc` | `ts-node src/ai-agents/generate-from-document.ts` | Generate from document |

### Docker Deployment

```yaml
# docker-compose.proxy.yml
services:
  proxy:
    image: node:20-bookworm-slim
    working_dir: /app
    command: node proxy-server.js
    ports:
      - "3001:3001"
    volumes:
      - .:/app
    env_file:
      - .env
```

### Build for Production

```bash
# Web production build
npx expo export --platform web

# iOS build
npx expo build:ios

# Android build
npx expo build:android
```

### Node.js Polyfill Configuration

Because the app runs in React Native (which lacks Node.js built-ins), several polyfills are configured:

**Babel aliases** (`babel.config.js`):
- `fs` → `./src/fs-polyfill` (no-op polyfill)
- `path` → `path-browserify`
- `crypto` → `crypto-browserify`
- `stream` → `stream-browserify`
- `buffer` → `buffer`
- `os` → `os-browserify/browser`

**Metro resolver** (`metro.config.js`):
- Same polyfill mapping for the bundler
- `sharp` is stubbed out (server-only dependency)

**Worker TypeScript** (`tsconfig.worker.json`):
- Uses CommonJS modules (not ESM)
- Has its own path aliases for React Native shims

---

## 26) Constraints and Known Limitations

### Runtime Constraints

- **Web feature completeness depends on proxy availability.** The web client cannot function without the local proxy server running. The proxy handles all file I/O and API proxying.
- **Large payloads can saturate local storage.** Generated stories with many images and audio files consume significant disk space. AsyncStorage has platform-dependent quotas.
- **External provider reliability.** LLM and image generation APIs are the primary runtime risk. Rate limits, outages, and quality variance all affect generation.

### Architecture Constraints

- **No offline generation.** The generation pipeline requires internet access to reach LLM and image APIs.
- **Single-machine execution.** Workers run as local child processes. There is no distributed job execution.
- **No incremental story updates.** Once a story is generated, it cannot be partially re-generated. The entire episode must be regenerated to change any content.

### Technical Debt

- Parallel generation strategies are partially implemented; some fall back to sequential execution.
- The proxy server is a single monolithic file (~2500 lines) that would benefit from modularization.
- Provider-specific configuration is spread across multiple files and could be centralized.
- Integration test coverage for checkpoint/resume/cancel flows is limited.

### Performance Considerations

- **Story generation:** 15-60+ minutes per episode depending on scene count, image count, and provider latency.
- **Image generation:** 3-15 seconds per image depending on provider and resolution.
- **Audio generation:** 2-5 seconds per beat for narration.
- **Client rendering:** Story playback is lightweight. The main performance concern is image loading for beat transitions.

---

*This document reflects the current implemented technical architecture as of February 26, 2026. All systems described are either fully implemented or have clear architectural foundations in the codebase.*
