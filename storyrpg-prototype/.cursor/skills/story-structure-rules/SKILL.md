---
name: story-structure-rules
description: Domain rules for StoryRPG story architecture including scene graphs, branch-and-bottleneck patterns, choice taxonomy, consequence budgets, and encounter design. Use when working on StoryArchitect, ChoiceAuthor, BranchManager, EncounterArchitect, or any story structure types.
---

# Story Structure Rules

## 3-Act / 7-Point Story Structure (season-level spine)

Every generated season is anchored by a 3-act / 7-point model. The structure is **load-bearing**: `SourceMaterialAnalyzer` infers it if the source material does not supply it, `SeasonPlannerAgent` distributes it across episodes, and `SevenPointCoverageValidator` enforces it in the Karpathy retry loop.

### Narrative Anchors

```typescript
interface StoryAnchors {
  stakes: string;            // What will break if the protagonist fails?
  goal: string;              // The concrete external goal.
  incitingIncident: string;  // The event that breaks the protagonist's status quo.
  climax: string;            // The decisive confrontation. MUST match sevenPoint.climax.
}
```

### Seven-Point Structure

```typescript
interface SevenPointStructure {
  hook: string;        // Ordinary world + core value introduced.
  plotTurn1: string;   // Protagonist commits to the goal; Act 1/Act 2 wall.
  pinch1: string;      // First major pressure — stakes escalate, allies falter.
  midpoint: string;    // Shift from reaction to action; new information reframes the goal.
  pinch2: string;      // Second major pressure — everything nearly lost.
  climax: string;      // Decisive confrontation. MUST match anchors.climax.
  resolution: string;  // New equilibrium; core value restated.
}
```

### Per-Episode Structural Roles

```typescript
type StructuralRole =
  | 'hook' | 'plotTurn1' | 'pinch1' | 'midpoint'
  | 'pinch2' | 'climax' | 'resolution'
  | 'rising' | 'falling';  // buffer episodes between named beats
```

Each `SeasonEpisode.structuralRole` lists the beat(s) that episode carries. The default distribution from `sevenPointDistribution.ts` is deterministic; the LLM may override if the source strongly demands it. `SevenPointCoverageValidator` guarantees every canonical beat appears at least once, in canonical order.

## Scene Graph Structure

### EpisodeBlueprint

```typescript
interface EpisodeBlueprint {
  episodeId: string;
  title: string;
  synopsis: string;
  arc: {
    hook: string;        // fill only if this episode carries the 'hook' beat
    plotTurn1: string;
    pinch1: string;
    midpoint: string;
    pinch2: string;
    climax: string;
    resolution: string;
  };
  structuralRole?: StructuralRole[];  // which 7-point beat(s) this episode carries
  themes: string[];
  scenes: SceneBlueprint[];
  startingSceneId: string;
  bottleneckScenes: string[];           // All paths must pass through these
  suggestedFlags: string[];
  suggestedScores: string[];
  suggestedTags: string[];
  narrativePromises: Array<{ description: string; setupScene: string; importance: string }>;
}
```

Fill each `arc.<beat>` field only when the episode's `structuralRole` includes that beat. Leave other beats empty — the season carries them elsewhere. `arc.climax` and `arc.plotTurn2` (fused into `climax`) should align with the season Climax anchor.

### SceneBlueprint

```typescript
interface SceneBlueprint {
  id: string;                           // kebab-case, e.g. "scene-market"
  name: string;
  description: string;
  location: string;
  mood: string;
  purpose: 'bottleneck' | 'branch' | 'transition';
  dramaticQuestion: string;
  wantVsNeed: string;
  conflictEngine: string;
  npcsPresent: string[];
  narrativeFunction: string;
  keyBeats: string[];
  choicePoint?: ChoicePointBlueprint;
  leadsTo: string[];                    // Navigation dependencies
  requires?: string[];                  // Explicit prerequisites
  isEncounter?: boolean;
  encounterType?: string;
  encounterDescription?: string;
  encounterDifficulty?: string;
  encounterBuildup?: string;
  encounterSetupContext?: string[];
  incomingChoiceContext?: string;        // For branch scenes: what led here
}
```

## Branch-and-Bottleneck Pattern

### Bottleneck Scenes

- All players experience them regardless of prior choices
- Used for: encounters, revelations, emotional peaks
- Typically 2-3 per episode
- Must be reachable from ALL branches
- Encounters are always bottlenecks

### Branch Scenes

- Player choices lead to different experiences
- Must reconverge at the next bottleneck
- Each branch should feel meaningfully different
- State changes must be reconcilable at reconvergence

### Rules

1. **No dead ends**: every scene must lead somewhere (via `leadsTo`)
2. **No orphan branches**: every branch must reconverge at a bottleneck
3. **No unreachable scenes**: every scene reachable from `startingSceneId`
4. **No infinite loops**: validated via cycle detection
5. **State consistency**: no contradictory state combinations at bottlenecks
6. **Bottleneck accessibility**: all bottlenecks reachable from all valid paths

### Reconvergence

Where branches meet, use conditional text based on flags/scores:
```
"setupTextVariants": [
  { "condition": "flag:chose_stealth", "text": "Having slipped past the guards..." },
  { "condition": "flag:chose_combat", "text": "Still catching your breath from the fight..." }
]
```

## Choice Taxonomy

### Choice Types (Distribution Targets)

| Type | Target % | Branches? | Key Rule |
|---|---|---|---|
| `expression` | ~35% | NEVER | Personality/voice. Must set flags for callbacks. No `nextSceneId`. |
| `relationship` | ~30% | May | NPC bond building. Must include >=1 relationship consequence. |
| `strategic` | ~20% | May | Skill/stat-based. Must include `statCheck` on >=1 option. |
| `dilemma` | ~15% | May | Value-testing, no right answer. Must include `statCheck`. Should set tint flags. |

### Branching Rules

Branching is a PROPERTY of any non-expression choice, not a type itself.
- Set `branches: true` on `choicePoint` when the scene should diverge
- Max 1-2 branching choice points per episode (encounter outcomes are the primary branch source)
- Expression choices must NEVER include `nextSceneId`

### Choice Density Rules

1. At least 50% of scenes MUST have a `choicePoint`
2. The first scene MUST have a `choicePoint`
3. Never more than 2 consecutive scenes without a `choicePoint`
4. First choice within ~60 seconds of reading
5. Average gap between choices <= 90 seconds

### Choice Structure

```typescript
interface Choice {
  id: string;
  text: string;                         // 5-15 words
  choiceType: 'expression' | 'relationship' | 'strategic' | 'dilemma';
  consequences: Consequence[];
  nextSceneId?: string;                 // Only for branching choices
  statCheck?: { attribute: string; difficulty: number };  // Required for relationship/strategic/dilemma
  outcomeTexts: { success: string; partial: string; failure: string };  // Required
  reactionText?: string;                // Required for non-branching choices
  tintFlag?: string;                    // For non-branching, sets "tint:xxx" flag
  stakesAnnotation?: { want: string; cost: string; identity: string };
  conditions?: Condition[];
  showWhenLocked?: boolean;
  lockedText?: string;
}
```

### Stakes Triangle

Every `choicePoint` must define all three:
- **Want**: What the player is trying to achieve
- **Cost**: What they risk or sacrifice
- **Identity**: What this says about who they are

## Consequence System

### Consequence Types

| Type | Format | Use |
|---|---|---|
| `setFlag` | `{ type: 'setFlag', flag: name, value: boolean }` | Boolean state. Use "tint:xxx" prefix for dilemma tint flags. |
| `changeScore` | `{ type: 'changeScore', score: name, change: number }` | Modify numeric values |
| `addTag` / `removeTag` | `{ type: 'addTag', tag: name }` | Identity markers |
| `relationship` | `{ type: 'relationship', npcId, dimension, change }` | Trust, affection, respect, fear changes |
| `attribute` | `{ type: 'attribute', ... }` | Core stats (rarely used) |

### Five-Factor Test

Every choice (except `expression`) MUST affect at least one of:
1. **Outcome**: What happens in the story
2. **Process**: How it happens
3. **Information**: What is learned
4. **Relationship**: Bonds with NPCs
5. **Identity**: Who the protagonist is becoming

Major choices should impact >= 3 of 5 factors.

### Delayed Consequences (Butterfly Effect)

```typescript
delayedConsequences: [{
  consequence: Consequence;
  description: string;
  delay: { type: 'scenes' | 'episodes'; count: number };
  triggerCondition?: string;
}]
```

Use sparingly: 1-2 delayed consequences per episode.

## Encounter Design

### Encounter Types

`combat` | `chase` | `stealth` | `social` | `puzzle` | `exploration` | `mixed`

Social encounters are versatile for literary/romantic/gothic stories.

### Design Principles

- **Encounter-first**: The encounter IS the episode. Everything else is setup.
- Placement: dramatic peak, roughly scene 3-5 (two-thirds through)
- 2-3 scenes before: setup and escalation
- 1-2 scenes after: consequence and resolution

### Encounter Structure

```typescript
interface Encounter {
  beats: EncounterBeat[];                   // 3-5 beats
  goalClock: { name: string; segments: 6; description: string };
  threatClock: { name: string; segments: number; description: string };  // 4-6 segments
  stakes: { victory: string; defeat: string };
  storylets: { victory: Storylet; partialVictory?: Storylet; defeat: Storylet; escape?: Storylet };
  environmentalElements: EnvironmentalElement[];
  npcStates: NPCEncounterState[];
  escalationTriggers: EscalationTrigger[];
  informationVisibility: InformationVisibility;
}
```

### Branching Tree (NOT Linear)

Each choice outcome (success/complicated/failure) contains `nextSituation` with embedded choices. This creates a tree, not a sequence.
- Maximum 3-4 layers of choices
- Terminal outcomes: `isTerminal: true, encounterOutcome: "victory" | "defeat" | "escape"`

### Prior State Payoff in Encounters

- `setupTextVariants`: Conditional text based on flags/relationships
- Conditional choices: `conditions` + `showWhenLocked` + `lockedText`
- `statBonus`: Difficulty reduction when condition is met (rewards prior choices)

### Storylets (Aftermath)

| Outcome | Beats | Consequences |
|---|---|---|
| Victory | 2 (Triumph, Forward Momentum) | +confidence, +skill used |
| Defeat | 3 (Impact, Reflection, Resolve) | +setbacks, +resolve, +skill developing |
| Escape | 2 (Close Call, Assessment) | +resourcefulness |
