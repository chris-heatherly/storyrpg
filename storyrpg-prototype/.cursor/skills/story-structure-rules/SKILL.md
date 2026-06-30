---
name: story-structure-rules
description: Domain rules for StoryRPG story architecture including scene graphs, branch-and-bottleneck patterns, choice taxonomy, consequence budgets, and encounter design. Use when working on StoryArchitect, ChoiceAuthor, BranchManager, EncounterArchitect, or any story structure types.
---

# Story Structure Rules

## Story Circle Story Structure (season-level spine)

Every generated season is anchored by the 8-beat Story Circle. The structure is **load-bearing**: `SourceMaterialAnalyzer` infers it if the source material does not supply it, `SeasonPlannerAgent` distributes it across episodes, and Story Circle coverage validators enforce it in the retry loop. Story Circle is supreme: arcs create story arcs across acts, with each episode serving the season-long Story Circle first and the arc pressure second.

### Narrative Anchors

```typescript
interface StoryAnchors {
  stakes: string;            // What will break if the protagonist fails?
  goal: string;              // The concrete external goal.
  incitingIncident: string;  // The event that breaks the protagonist's status quo.
  climax: string;            // The decisive confrontation.
}
```

### Story Circle Structure

```typescript
interface StoryCircleStructure {
  you: string;     // Ordinary world + starting identity.
  need: string;    // Inner/external lack made urgent.
  go: string;      // Threshold crossing.
  search: string;  // Adaptation under pressure.
  find: string;    // Discovery or recontextualization.
  take: string;    // Costly acquisition.
  return: string;  // Bring change home.
  change: string;  // New equilibrium and identity shift.
}
```

### Per-Episode Story Circle Roles

```typescript
type StoryCircleBeat =
  | 'you' | 'need' | 'go' | 'search'
  | 'find' | 'take' | 'return' | 'change';
```

Each `SeasonEpisode.storyCircleRole` lists the beat(s) that episode carries. The default distribution from `storyCircleDistribution.ts` is deterministic; the LLM may override if the source strongly demands it. Story Circle coverage guarantees every canonical beat appears at least once, in canonical order.

## Scene Graph Structure

### EpisodeBlueprint

```typescript
interface EpisodeBlueprint {
  episodeId: string;
  title: string;
  synopsis: string;
  arc: StoryCircleStructure;
  storyCircleRole?: StoryCircleRoleAssignment[];
  arcPressureBand?: string;
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

Fill `arc.<beat>` fields as the episode-local expression of the Story Circle. Arc pressure bands are secondary and should not override the episode's Story Circle role.

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

## Scene-First Planning (season level, default-on)

The default flow is **Story Circle-first**: `SeasonPlannerAgent` assigns each episode one or more Story Circle roles, and
it also builds a season-level scene spine. **Scene-first planning** is ON by default and opt-out via
`SCENE_FIRST_PLANNING=0`; it is not a `sceneEpisode`-only mode. `StoryArchitect` elaborates planned
scenes into episode blueprints when `seasonPlanDirectives.plannedScenes` is present.

### Altitude cascade

```
SEASON   → owns the Story Circle structure + the episode/scene plan
EPISODE  → maps to Story Circle role(s)
SCENE    → serves the purpose its episode's role names (PlannedScene.dramaticPurpose)
BEAT     → serves its scene (still generated later, in the per-episode loop)
```

Scenes do **not** carry a competing season-structure label; they inherit their dramatic brief from the episode's Story Circle role.

### The artifacts

- **`SeasonScenePlan`** (`src/types/scenePlan.ts`) on `SeasonPlan.scenePlan`; per-episode slice on
  `SeasonEpisode.plannedScenes`. Built by `seasonScenePlanBuilder.ts` from data the season plan
  already carries (`storyCircleRole`, `plannedEncounters`, synopsis, `treatmentGuidance`, plus
  consequence chains / choice moments / information ledger), then optionally upgraded by
  `SeasonPlannerAgent.authorScenePlanLLM` for non-treatment runs.
- **`PlannedScene`**: `kind: 'standard' | 'encounter'`, `narrativeRole`
  (`setup | development | turn | payoff | release`), `dramaticPurpose`, `setsUp[]`, `paysOff[]`.
  Current plans may also carry `coldOpenProfile` and `sceneConstructionProfile` obligations that
  feed required-beat and scene-turn guidance downstream.
- **Encounters are a kind of scene**: `kind: 'encounter'` with a `PlannedSceneEncounter` sub-object;
  the scene id **is** the encounter id. No separate encounter list — pacing and the
  consequence/branch budget see encounters by construction.
- **Setup/payoff graph**: `setsUp`/`paysOff` + `SeasonScenePlan.setupPayoffEdges` make cross-scene
  relationships explicit and **must point forward in time**. `SceneSpineValidator` checks coverage,
  reference integrity, agreement, and forward-direction.

### How it flows downstream

- `planningHelpers.buildSeasonPlanDirectives` passes the episode's `plannedScenes` + the edges that
  touch it into `StoryArchitectInput.seasonPlanDirectives`.
- **StoryArchitect elaborate-mode**: when `plannedScenes` are present, `execute()` builds the
  blueprint from them (no LLM call) and routes through the SAME repair pipeline as invention; encounter
  scenes are mapped via `applyPlannedEncounterToScene` so the existing `isEncounter`/`encounterType`
  per-kind dispatch (SceneWriter vs EncounterArchitect) is unchanged.
- From-scratch runs get treatment-shaped guidance synthesized (`synthesizeTreatmentGuidance.ts`), so
  there is a single uniform downstream path.

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

## Season Choice/Consequence Budgets (scene-first, opt-in)

When scene-first planning is enabled, the season layers a **weighted "dramatic diet"** over its scene
plan *before episodes generate*. The governing idea is **"budget the spine, not the texture"**: the
budgeted unit is ONE central choice per choice-bearing scene OR per encounter. Tactical choices inside
an encounter still matter and produce consequences, but they are NOT individually budgeted.

### Weighting

- A standard scene choice has `budgetWeight = SCENE_BUDGET_WEIGHT` (1).
- An encounter has `budgetWeight = ENCOUNTER_BUDGET_WEIGHT` (3) — a concentrated, intense serving of
  ONE role.
- All budget mixes are measured on **weighted** totals, never raw counts.

### Choice-type budget

Weighted target across budgeted units: **expression 35 / relationship 30 / strategic 20 / dilemma 15**
(`CHOICE_TYPE_TARGET`).

- An encounter carries exactly ONE non-expression role drawn from
  `{ relationship, strategic, dilemma }` — encounters are **never `expression`** (expression is
  voice / no-stakes; encounters are stakes-driven).
- Standard choice-scenes may be any of the four types.

### Consequence-tier budget

Recalibrated **unified** target (encounters included): **callback 50 / tint 25 / branchlet 17 /
branch 8** (`CONSEQUENCE_TARGET`). Branch/branchlet rise vs the old scenes-only mix because encounters
legitimately branch. Hard invariants:

- an `expression` unit ⇒ `callback`;
- a `dilemma` unit ⇒ at least `branchlet`;
- **ANY encounter ⇒ at least `branchlet`** (never a bare `callback`, branch-point or not); branch-point
  encounters get their `branch`/`branchlet` slots allocated first.

### Allocation + validation

- **Allocation** runs at season-planning time over the scene plan, consequential-first: encounters take
  their non-expression / branch-heavy slots FIRST, then standard scenes fill the remainder (so scenes
  auto-absorb expression and relationship and lighter tiers). Authored `choiceType` / `consequenceTier`
  preferences are respected where they don't violate an invariant; reconciliation toward target is one
  GENTLE pass (authored-drama-wins). See `seasonBudgetAllocator.ts`: `buildBudgetUnits`,
  `allocateChoiceTypes`, `allocateConsequenceTiers`, `weightedChoiceMix`, `weightedConsequenceMix`.
- **Validation** (`SeasonBudgetValidator`) runs after allocation and before the plan is finalized. It
  checks both weighted mixes against target within `BUDGET_TOLERANCE` (warn 15 / error 25 pts per
  type/tier) plus the hard invariants. Advisory by default; hard-gates only under
  `GATE_SEASON_BUDGETS=1` (**default-off**).

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
