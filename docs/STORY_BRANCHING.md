# Story Branching System

How StoryRPG creates, manages, and constrains story branches.

**Last Updated:** April 2026

See also the companion design plans that extend this system:
- `PLAN_DELAYED_CONSEQUENCES.md` — how the callback ledger and delayed consequences layer on top of branching
- `PLAN_MULTI_SCENE_BRANCH_ZONES.md` — proposed multi-scene branch zones between bottlenecks
- `PLAN_POST_EPISODE_FLOWCHART.md` — post-episode flowchart and ending-mode planning

---

## Table of Contents

1. [Core Architecture: Branch-and-Bottleneck](#1-core-architecture-branch-and-bottleneck)
2. [How Branches Are Created](#2-how-branches-are-created)
3. [Branch Types](#3-branch-types)
4. [Rules and Constraints](#4-rules-and-constraints)
5. [Scene Graph Structure](#5-scene-graph-structure)
6. [Encounter Branching (Storylets)](#6-encounter-branching-storylets)
7. [Cross-Episode Branching](#7-cross-episode-branching)
8. [Reconvergence](#8-reconvergence)
9. [Runtime Branch Tracking](#9-runtime-branch-tracking)
10. [Validation](#10-validation)
11. [Configuration](#11-configuration)
12. [PartialVictory Branching](#12-partialvictory-branching)
13. [Key Files Reference](#13-key-files-reference)

---

## 1. Core Architecture: Branch-and-Bottleneck

Episodes follow a **"String of Pearls"** pattern:

```
Bottleneck → Branch Zone → Bottleneck → Branch Zone → Bottleneck
  (Pearl)                    (Pearl)                    (Pearl)
```

- **Bottleneck scenes** are key story moments that ALL players experience regardless of prior choices. They serve as narrative anchors — crucial plot points, revelations, emotional peaks. Typically 2–3 per episode.
- **Branch zones** are the spaces between bottlenecks where player choices create divergent paths. Different players may experience entirely different scenes in these zones.
- **All branches must eventually reconverge** at the next bottleneck. There are no permanent divergences within an episode.

### Scene Purpose Types

Every scene in the blueprint is assigned one of three purposes (defined as the `ScenePurpose` type in `src/types/common.ts`):

| Purpose | Description |
|---|---|
| `bottleneck` | All paths must pass through this scene |
| `branch` | Player choice leads to different experiences |
| `transition` | Connecting tissue between bottlenecks/branches |

### Episode Structure Guidelines

| Element | Target Count |
|---|---|
| Scenes per episode | 5–8 (cap: `maxScenesPerEpisode` from `SCENE_DEFAULTS`) |
| Bottleneck scenes | 2–3 |
| Branch scenes | 1–2 |
| Transition scenes | Remainder |

---

## 2. How Branches Are Created

Branching is **a property of choices, not a choice type**. Any non-expression choice can optionally route the player to a different scene.

### The Mechanism

A choice creates a branch when it includes a `nextSceneId` field:

```typescript
interface Choice {
  id: string;
  text: string;
  choiceType?: 'expression' | 'relationship' | 'strategic' | 'dilemma';

  nextSceneId?: string;  // THIS creates a branch — routing to a different scene
  nextBeatId?: string;   // For routing within the same scene (not a branch)
}
```

When a player selects a choice with `nextSceneId`, the engine routes them to that scene instead of following the default scene sequence. This is **player-driven branching**.

### What's NOT a Branch

- **Conditional auto-routing** (`Scene.leadsTo`): The engine picks the first scene whose conditions the player satisfies. This is system-driven, not player-driven.
- **Expression choices**: Cosmetic/personality choices that never route to different scenes.
- **Beat navigation** (`nextBeatId`): Moving within the same scene is not branching.

### Generation Pipeline

Branches are created across multiple pipeline stages:

1. **Story Architect** creates the episode blueprint, marking scenes with `purpose: 'branch'` and setting `choicePoint.branches: true` where branching should occur.
2. **Choice Author** creates the actual choices for each scene. For scenes with `branches: true`, choices include `nextSceneId` values that reference scenes in the parent scene's `leadsTo` array.
3. **Encounter Architect** creates tactical branching via storylets — encounter outcomes (victory/defeat/escape/partialVictory) that route to different follow-up scenes.
4. **Branch Manager** analyzes the complete branch structure, validates it, and reports issues.

Additional pipeline utilities support branch analysis:
- `src/ai-agents/utils/branchTopology.ts` provides `analyzeBranchTopology` for structural graph analysis.
- `src/ai-agents/utils/dependencyGraph.ts` computes scene graph topology and topological waves from an `EpisodeBlueprint`.

---

## 3. Branch Types

### By Mechanism

| Type | Source | Description |
|---|---|---|
| **Choice branches** | Player picks a choice with `nextSceneId` | Direct player agency — "I choose this path" |
| **Encounter branches** | Victory/defeat/escape/partialVictory outcomes route to different storylets | Skill-based — "I earned this path" |
| **Conditional branches** | `Scene.leadsTo` with conditions | State-driven — the game routes based on player history |

### By Narrative Weight (Choice Geometry)

From the storytelling principles (`src/ai-agents/prompts/storytellingPrinciples.ts`), choices fall along a cost spectrum:

| Level | Name | Description |
|---|---|---|
| Free | **Flavor Choices** | Personalization without consequence. No branching. |
| Medium | **Branching Choices** | Different scenes/experiences, may converge later |
| Variable | **Blind Choices** | Hidden consequences revealed later |
| High | **Moral Dilemmas** | Identity-defining, structural impact |

### By Consequence Budget

| Tier | Cost | Description |
|---|---|---|
| **Callback Lines** | Cheap | NPCs reference prior choices in dialogue |
| **Scene Tints** | Medium | Same scene, different flavor based on prior choices |
| **Branchlets** | Expensive | Entirely different scenes based on choices |
| **Structural Branches** | Very Expensive | Different story paths, potentially different endings |

### By Tone

Each branch path can carry a narrative tone:

- `dark` — Darker narrative path
- `hopeful` — More optimistic path
- `neutral` — Balanced path
- `tragic` — Tragic outcomes
- `redemption` — Redemption arc

The tone is tracked on the `Scene.branchType` field and recorded in the player's branch history at runtime.

---

## 4. Rules and Constraints

### Hard Rules

1. **Maximum 2 branching choice points per episode** (configurable via `maxBranchingChoicesPerEpisode` in `GenerationSettingsConfig`). Encounters provide additional tactical branching on top of this cap.

2. **Expression choices must NEVER branch.** They are cosmetic/personality choices and must not include `nextSceneId`. This is validated and will produce an error.

3. **All branches must reconverge at bottlenecks.** No dead ends, no orphaned branches. Every branch path must eventually reach a bottleneck scene.

4. **No dead ends.** Every scene must lead somewhere.

5. **No unreachable scenes.** Every scene must be reachable from the start.

6. **`nextSceneId` must reference a scene in the parent scene's `leadsTo` array.** Choices cannot route to arbitrary scenes.

7. **Branching and Dilemma choices MUST affect at least 1 of the Five Factors** (Outcome, Process, Information, Relationship, Identity). Richer choices affect 2–3.

### Choice Type Distribution

Choice types follow target percentages across an episode (from `CORE_STORYTELLING_PROMPT` in `storytellingPrinciples.ts` and `GenerationSettingsConfig`):

| Type | Target % | Can Branch? |
|---|---|---|
| `expression` | ~20% | **Never** |
| `relationship` | ~25% | Yes |
| `strategic` | ~30% | Yes |
| `dilemma` | ~25% | Yes |

These are configurable via `choiceDistExpression`, `choiceDistRelationship`, `choiceDistStrategic`, and `choiceDistDilemma` in `GenerationSettingsConfig`.

### Stakes Triangle

Every meaningful branching choice must have all three components:

- **WANT** — What clear goal or desire drives this moment?
- **COST** — What must be sacrificed, risked, or given up?
- **IDENTITY** — What does this choice say about who the player is?

---

## 5. Scene Graph Structure

### Scene Blueprint (Generation Time)

```typescript
interface SceneBlueprint {
  id: string;
  name: string;
  purpose: 'bottleneck' | 'branch' | 'transition';

  choicePoint?: {
    type: 'expression' | 'relationship' | 'strategic' | 'dilemma';
    branches?: boolean;
    stakes: {
      want: string;
      cost: string;
      identity: string;
    };
    description: string;
    optionHints: string[];
  };

  leadsTo: string[];
  requires?: string[];
  incomingChoiceContext?: string;

  isEncounter?: boolean;
  encounterType?: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  encounterDescription?: string;
  encounterDifficulty?: 'easy' | 'moderate' | 'hard' | 'extreme';
  encounterBuildup?: string;
  encounterSetupContext?: string[];
  encounterPartialVictoryCost?: EncounterCost;
}
```

### Scene (Runtime)

```typescript
interface Scene {
  id: string;
  name: string;
  beats: Beat[];
  leadsTo?: string[];

  isBottleneck?: boolean;
  isConvergencePoint?: boolean;
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';

  conditions?: ConditionExpression;
  fallbackSceneId?: string;
}
```

### Navigation Priority

When the engine determines the next scene:

1. **Player choice with `nextSceneId`** — highest priority, player-driven branching
2. **`Scene.leadsTo` array** — conditional auto-routing, first valid target wins
3. **Sequential advancement** — fallback to next scene in array order

---

## 6. Encounter Branching (Storylets)

Encounters are the **primary branching mechanism** in StoryRPG. They create tactical, skill-based branches where the outcome is earned through gameplay.

### How It Works

Every encounter generates **storylets** — short narrative aftermath sequences for each outcome:

```typescript
interface Encounter {
  // ...
  storylets?: {
    victory?: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat?: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };
}
```

Each storylet is a 1–3 beat mini-scene that:
- Has a unique narrative tone per outcome (triumphant, somber, relieved, etc.)
- Sets flags for later callbacks (e.g., `encounter_scene1_victory: true`)
- Applies consequences (score changes, relationship shifts)
- Routes to a different `nextSceneId` based on outcome

### Encounter Decision Trees

Within an encounter, choices form a branching tree:

- Each action outcome (success/complicated/failure) leads to a **different** `nextSituation`
- Trees go 2–3 layers deep before reaching terminal outcomes
- Terminal outcomes map to `encounterOutcome: 'victory' | 'defeat' | 'escape' | 'partialVictory'`
- The encounter outcome triggers the appropriate storylet

### Runtime Encounter Shape

At runtime, encounters are phase-based:

```typescript
interface Encounter {
  phases: Array<{
    id: string;
    situationImage?: string;
    beats: EncounterBeat[];
  }>;
  // ...
}
```

The live runtime path uses `encounter.phases[].beats`. Legacy `encounter.beats` is only supported as a compatibility fallback in `src/engine/storyEngine.ts`.

### Dual Clock System

Encounters use a Blades in the Dark-inspired clock system:
- **Goal Clock**: Player's objective progress (typically 6 segments)
- **Threat Clock**: Escalating danger (typically 4–6 segments)
- Victory when goal fills first; defeat when threat fills first

### Encounter Slot Manifests

The encounter image system uses dedicated slot manifests (`src/ai-agents/encounters/`) to track and validate image coverage across the encounter tree:
- `encounterSlotManifest.ts` — builds and validates encounter beat image slots
- `storyletSlotManifest.ts` — builds and validates storylet aftermath image slots
- `encounterProviderPolicy.ts` — provider selection and health tracking for encounter images

---

## 7. Cross-Episode Branching

Branches can span across episodes in a season, creating long-term consequences.

### Structure

```typescript
interface CrossEpisodeBranch {
  id: string;
  name: string;
  originEpisode: number;
  trigger: {
    type: 'encounter_outcome' | 'story_choice' | 'relationship_state' | 'flag_condition';
    description: string;
  };
  paths: Array<{
    id: string;
    name: string;
    condition: string;
    affectedEpisodes: Array<{
      episodeNumber: number;
      impact: 'major' | 'moderate' | 'minor';
      description: string;
    }>;
  }>;
  reconvergence?: {
    episodeNumber: number;
    description: string;
  };
}
```

Defined in `src/types/sourceAnalysis.ts`.

### How Episodes Connect

Episodes declare their branch connections:
- `outgoingBranches` — CrossEpisodeBranch IDs that originate from this episode
- `incomingBranches` — CrossEpisodeBranch IDs that affect this episode
- `setsFlags` — Flags this episode sets for future episodes to check
- `checksFlags` — Flags from prior episodes that alter this episode's content

### Impact Levels

- **Major** — Significantly different scenes or story paths
- **Moderate** — Altered dialogue, different NPC attitudes, scene tints
- **Minor** — Callback lines, small acknowledgments

---

## 8. Reconvergence

All branches must eventually reconverge. This is enforced structurally.

### Reconvergence Points

```typescript
interface ReconvergencePoint {
  sceneId: string;
  incomingBranches: string[];
  stateReconciliation: StateReconciliation[];
  narrativeAcknowledgment: string;
}

interface StateReconciliation {
  stateVariable: string;
  possibleValues: string[];
  howToHandle: string;
}
```

### Requirements at Reconvergence

When branches merge at a bottleneck:

1. **State reconciliation** — Handle conflicting state from different branches. If Branch A set `trust_npc = high` and Branch B set `trust_npc = low`, the reconvergence point must handle both.
2. **Narrative acknowledgment** — The scene must acknowledge which path the player took. Use conditional text based on flags/scores (text variants).
3. **All bottleneck scenes must be reachable from all valid paths.** The Branch Manager validates this.

---

## 9. Runtime Branch Tracking

The game store (`src/stores/gameStore.ts`) tracks the player's branch history during play.

### What's Tracked

```typescript
interface BranchPathEntry {
  fromSceneId: string;
  toSceneId: string;
  choiceId?: string;
  branchTone?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  timestamp: number;
}
```

### Available Methods

| Method | Description |
|---|---|
| `recordBranchChoice(from, to, choiceId?)` | Records that the player branched from one scene to another |
| `getBranchHistory()` | Returns the full list of branch path entries |
| `wasSceneVisited(sceneId)` | Whether the player has been to a scene (via scene history or branch history) |
| `getBranchToneForScene(sceneId)` | Gets the tone of the branch that led to a scene |
| `getPathToScene(sceneId)` | Walks backwards through branch history to reconstruct the path |

### Persistence

Branch history is persisted to AsyncStorage and survives app restarts. Storage keys:
- `gameStore_branchHistory` — JSON array of `BranchPathEntry`
- `gameStore_currentBranchTone` — Current branch tone string

---

## 10. Validation

Multiple systems validate branch structure:

### Choice Distribution Validator

`src/ai-agents/validators/ChoiceDistributionValidator.ts` runs during generation to enforce:
- Branching frequency stays within the per-episode cap
- Expression choices never have `nextSceneId`
- Choice type percentages stay near targets

Violations produce errors (blocks generation) or warnings. A **branching penalty** of 15 points per excess branch is applied to the quality score.

### Branch Manager

`src/ai-agents/agents/BranchManager.ts` analyzes the complete episode structure and checks for:

| Issue Type | Severity | Description |
|---|---|---|
| `dead_end` | Error | A scene that leads nowhere |
| `orphan_branch` | Error | A branch that never reconverges |
| `unreachable_scene` | Error | A scene that can't be reached from start |
| `missing_reconvergence` | Warning | Branches that don't clearly merge |
| `state_conflict` | Warning | Contradictory state combinations possible |

### Structural Validator

`src/ai-agents/validators/StructuralValidator.ts` checks at the individual scene/beat level:
- `nextSceneId` references actually exist
- Encounter outcomes have `nextSceneId`
- No dead ends in navigation chains

Note: `StructuralValidator` is not re-exported from the `validators/index.ts` barrel — import it directly.

### Phase Validator

`src/ai-agents/validators/PhaseValidator.ts` provides configurable blocking/warning thresholds for phase-level validation (defaults: `blockingThreshold: 40`, `warningThreshold: 60`).

### Branch Topology Analysis

`src/ai-agents/utils/branchTopology.ts` provides `analyzeBranchTopology` for structural graph analysis during generation.

---

## 11. Configuration

### Branching Settings

| Setting | Default | Location |
|---|---|---|
| `maxBranchingChoicesPerEpisode` | 2 | `GenerationSettingsConfig` in `config.ts` |
| `maxScenesPerEpisode` | 6 | `SCENE_DEFAULTS` in `constants/pipeline.ts` |
| `majorChoiceCount` | 3 | `SCENE_DEFAULTS` in `constants/pipeline.ts` |

### Choice Distribution Targets

| Type | Default Target |
|---|---|
| `choiceDistExpression` | 20% |
| `choiceDistRelationship` | 25% |
| `choiceDistStrategic` | 30% |
| `choiceDistDilemma` | 25% |

All configurable via `GenerationSettingsConfig` and exposed in the UI.

---

## 12. PartialVictory Branching

Encounter branching now distinguishes clean victory from costly success.

- `Encounter.outcomes.partialVictory` carries both legacy `complication` prose and a structured `EncounterCost` payload (defined in `src/types/index.ts`).
- `EncounterCost` specifies: domain, severity, payer (bearer), immediate effect, visible complication, lingering effect, and optional mechanical consequences.
- A valid partial-victory branch should either play a `partialVictory` storylet aftermath or route directly with an explicit `nextSceneId`.
- Partial-victory aftermath beats should make the price readable in text and in `visualContract.visibleCost`, so the branch does not collapse into ordinary victory.
- Older generated stories remain compatible because converter fallback logic in `encounterConverter.ts` derives a structured cost from existing prose and consequences when the new field is absent.
- Incremental and structural validators now reject partial-victory paths that lack structured cost data or fail to make that cost visible in their visual contracts.

---

## 13. Key Files Reference

| File | Role |
|---|---|
| `src/types/index.ts` | Core `Scene`, `Choice`, `ChoiceType`, `EncounterType`, `EncounterNarrativeStyle`, `EncounterCost` definitions |
| `src/types/common.ts` | `ScenePurpose` type and validation |
| `src/types/sourceAnalysis.ts` | `CrossEpisodeBranch`, `EpisodeOutline`, `PlannedEncounter`, `EncounterCategory` |
| `src/ai-agents/agents/StoryArchitect.ts` | Creates `SceneBlueprint` / `EpisodeBlueprint` with branch structure |
| `src/ai-agents/agents/ChoiceAuthor.ts` | Creates choices with `nextSceneId` for branching |
| `src/ai-agents/agents/BranchManager.ts` | Analyzes and validates branch structure |
| `src/ai-agents/agents/EncounterArchitect.ts` | Creates encounter storylets (tactical branching) |
| `src/ai-agents/validators/ChoiceDistributionValidator.ts` | Enforces branching cap and expression-no-branch rule |
| `src/ai-agents/validators/PhaseValidator.ts` | Phase-level validation with blocking/warning thresholds |
| `src/ai-agents/prompts/storytellingPrinciples.ts` | Branch-and-Bottleneck, Choice Geometry, Stakes Triangle |
| `src/ai-agents/config.ts` | `maxBranchingChoicesPerEpisode` and distribution targets |
| `src/ai-agents/utils/branchTopology.ts` | `analyzeBranchTopology` for structural graph analysis |
| `src/ai-agents/utils/dependencyGraph.ts` | Scene graph topology and topological waves |
| `src/ai-agents/encounters/encounterSlotManifest.ts` | Encounter image slot tracking for branch coverage |
| `src/ai-agents/encounters/storyletSlotManifest.ts` | Storylet image slot tracking |
| `src/ai-agents/converters/encounterConverter.ts` | Converts authored encounter structure to runtime shape |
| `src/engine/storyEngine.ts` | Runtime scene navigation and branch routing |
| `src/stores/gameStore.ts` | Runtime branch history tracking and persistence |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Orchestrates all agents in sequence |