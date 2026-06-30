# Gameplay Systems and Narrative Integration Guide

This guide explains how StoryRPG's hidden gameplay systems work and how they feed back into narrative. The player should experience story, character, and consequence. Under the hood, deterministic runtime systems and generation-time validators keep that experience coherent.

## Core Principle

Every gameplay system has two layers:

1. Hidden mechanical state: attributes, skills, flags, scores, tags, relationships, conditions, routes, clocks, and consequences.
2. Fiction-first narrative surface: prose, choices, NPC behavior, visual staging, encounter costs, callbacks, and ending variation.

The job of the system is not to show the player numbers. The job is to make the story remember what happened and respond in ways that feel authored.

## Runtime State Model

The runtime player state is the single source of truth for gameplay during reading.

It stores:

- Character name and pronouns.
- Hidden attributes.
- Hidden skills.
- NPC relationships.
- Flags, scores, and tags.
- Identity profile.
- Pending delayed consequences.
- Inventory.
- Current story, episode, and scene ids.
- Completed episodes.
- Visit log and episode completion summaries.

Technical map:

- `PlayerState` is defined in `storyrpg-prototype/src/types/player.ts`.
- Default state is created by `createInitialPlayerState` in `src/stores/playerStatePersistence.ts`.
- The active store is React Context in `src/stores/gameStore.ts`, not Zustand.
- Player state is serialized to AsyncStorage with tags converted between `Set<string>` and arrays.
- Encounter state is separately serialized by `encounterStatePersistence.ts`.

## Story Initialization

Gameplay begins when a story initializes player state.

Initialization does four important things:

- Copies default attributes, then overlays story-specific initial attributes.
- Copies story-specific initial skills, tags, and inventory.
- Creates one relationship record per story NPC from `initialRelationship`.
- Sets the current story id while leaving episode, scene, and beat to be loaded separately.

Narrative integration:

- A story can start with a protagonist who already has history, competence, social ties, or symbolic items.
- Initial tags and inventory should still be explained by the story premise.
- Initial relationships should match the fiction of who already knows whom.

Technical map:

- `gameStore.initializeStory` performs initialization.
- `Story.initialState` and `Story.npcs` are defined in `story.ts`.
- Initial tags hydrate into a `Set<string>` in player state.

## Attributes

Attributes are the protagonist's hidden core capacities. They start around neutral and range from 0 to 100.

| Attribute | Narrative meaning | Typical story use |
|---|---|---|
| Charm | Social magnetism, persuasion, presence | Negotiation, calming people, bluffing with confidence. |
| Wit | Cleverness, pattern recognition, quick thought | Puzzles, perception, quick improvisation, detecting contradictions. |
| Courage | Risk tolerance and physical bravery | Danger, intimidation, daring action, standing firm. |
| Empathy | Emotional perception and care | Reading NPCs, bonding, defusing tension, compassion. |
| Resolve | Endurance, discipline, will | Resisting pressure, surviving hardship, holding focus. |
| Resourcefulness | Improvisation and practical adaptation | Limited tools, environment use, survival, stealthy solutions. |

Narrative integration:

- Attribute changes should be surfaced as inner steadiness, sharper thought, narrowing options, shaken confidence, or stronger presence.
- Attribute checks should not mention the attribute name unless it is natural prose.
- Attribute growth should feel like lived experience, not leveling up.

Technical map:

- `PlayerAttributes` lives in `player.ts`.
- Defaults live in `src/stores/playerStatePersistence.ts` and `src/constants/pipeline.ts`.
- Attribute consequences are applied in `gameStore.applyConsequences`.
- Attribute conditions are evaluated in `conditionEvaluator.ts`.

## Skills

Skills are genre-facing competencies. The canonical default skill definitions are:

| Skill | Weighted attributes |
|---|---|
| Athletics | Courage, resolve, resourcefulness |
| Stealth | Wit, resourcefulness, courage |
| Perception | Wit, empathy, resolve |
| Persuasion | Charm, empathy, wit |
| Intimidation | Courage, resolve, charm |
| Deception | Charm, wit, resourcefulness |
| Investigation | Wit, resolve, empathy |
| Survival | Resourcefulness, resolve, courage |

Stories may also use genre-specific skills, but the runtime can fall back safely if a skill is unknown.

Narrative integration:

- Skills should appear as capability, preparation, perception, and altered outcomes.
- A high skill should unlock useful fiction or improve chances, not produce a visible "skill check" label.
- Skill use can produce growth, even on failure, because the protagonist learned from pressure.

Technical map:

- Skill definitions live in `storyrpg-prototype/src/constants/pipeline.ts`.
- `computeEffectiveStat` in `resolutionEngine.ts` blends skill training with an attribute ceiling.
- Unknown skills fall back to a simple capped skill value.
- `buildUseBasedGrowthConsequences` emits skill growth after stat checks.
- `SkillCoverageValidator`, `SkillSurfaceValidator`, and `StatCheckBalanceValidator` inspect skill use.

## Fiction-First Skill Surfaces

StoryRPG uses several surfaces to make hidden skills matter:

| Surface | What it does | Example |
|---|---|---|
| Passive insight | Shows extra usable information before a choice. | The protagonist notices a guard avoiding one doorway. |
| Prepared advantage | Prior state quietly improves a later check. | An ally's trust gives the protagonist an opening in negotiation. |
| Choice affordance | State changes available options, wording, or locked reasons. | A learned clue opens a direct accusation. |
| Outcome texture | Success, complication, and failure produce different fiction. | A lock opens cleanly, opens with noise, or jams and alerts someone. |
| Branch residue | Major choices leave later visible differences. | A spared enemy appears later with a warning or a debt. |

Technical map:

- Passive insights are `Beat.skillInsights`, with each `SkillInsight` carrying weights, threshold, text, priority, optional condition, and optional flag.
- Prepared advantages are `Choice.statCheck.modifiers`.
- Affordance source is `Choice.affordanceSource`.
- Outcome texture comes from `Choice.outcomeTexts`, `resolutionEngine`, and encounter outcomes.
- Branch residue is encoded through flags, relationships, tags, scores, text variants, residue hints, callback hooks, and route state.

## Conditions

Conditions decide whether content is available. They can gate choices, scenes, episodes, text variants, modifiers, delayed consequence triggers, and more.

Supported condition types:

- Attribute.
- Skill.
- Relationship.
- Flag.
- Score.
- Tag.
- Item.
- Identity.
- Compound `and`, `or`, and `not`.

Narrative integration:

- A locked or hidden option should feel like story reality, not UI punishment.
- `showWhenLocked` can preserve player awareness when a missing capability is dramatically useful.
- Locked text should be fiction-first: "Not yet. A different approach, ally, or hard-won lesson could change this."

Technical map:

- Condition types live in `conditions.ts`.
- `evaluateCondition` in `conditionEvaluator.ts` evaluates the tree.
- The evaluator tolerates some legacy/generated shapes by inferring missing condition types.
- Scene skip and fallback behavior use conditions through `storyEngine.shouldSkipScene`, `getNextScene`, and `getSceneById`.

## Choices

Choices are the player's main gameplay input. They can express identity, alter relationships, solve problems, branch routes, trigger checks, queue delayed consequences, and change future text.

Choice types:

- `expression`: voice/personality; should not branch.
- `relationship`: shifts or tests a bond.
- `strategic`: applies competence to a practical situation.
- `dilemma`: forces value conflict and identity definition.

Choice intents:

- `flavor`: free/cosmetic.
- `branching`: different immediate experience.
- `blind`: hidden consequences revealed later.
- `dilemma`: moral/identity-defining pressure.

Narrative integration:

- Meaningful choices should affect outcome, process, information, relationship, or identity.
- Rich choices often affect two or three of those factors.
- A choice should have clear want, cost, and identity pressure.
- The player should understand the fiction of the decision, not the math behind it.

Technical map:

- `Choice` lives in `choice.ts`.
- `processChoices` filters/locks choices and builds display metadata.
- `executeChoice` checks availability, resolves stat checks, injects outcome flags, collects consequences, and returns routing.
- `gameStore.commitChoice` records visit-log choice commits for recap/flowchart features.
- `ChoiceImpactValidator`, `StakesTriangleValidator`, `FiveFactorValidator`, `ChoiceCoverageValidator`, and related validators audit choices.

## Resolution System

The resolution system handles hidden checks. It is narrative-generous and three-tiered:

- Success: the protagonist achieves the goal cleanly or decisively.
- Complicated: the goal is partly achieved, but cost or twist enters.
- Failure: the goal fails or worsens, but story still moves forward.

Important design rules:

- Failure should be playable pressure, not a dead end.
- Checks should usually have authored outcome text.
- Randomness exists, but preparation, skill, and prior state influence the distribution.
- The player sees outcome fiction, not target numbers or probabilities.

Technical map:

- `resolveStatCheck` lives in `resolutionEngine.ts`.
- Checks normalize legacy `attribute`/`skill` fields into `skillWeights`.
- `computeOverlap` calculates effective skill coverage.
- `calculateOutcomeChances` creates weighted bands from advantage score.
- `ResolutionTracker` adds fairness bonuses after repeated failures.
- Active `statCheck.modifiers` can add hidden deltas and fiction-first hints.
- `executeChoice` injects `_outcome_success`, `_outcome_partial`, and `_outcome_failure` flags so payoff beats can choose the right text variant.

## Consequence System

Consequences are how choices and beats change the world.

Immediate consequence types:

- Attribute change.
- Skill change.
- Relationship change.
- Set flag.
- Change score.
- Set score.
- Add tag.
- Remove tag.
- Add item.
- Remove item.

Delayed consequences include:

- The consequence payload.
- A human-readable description.
- Optional delay by scene or episode count.
- Optional trigger condition.
- Source scene and choice ids.
- Elapsed counters.
- Fired status.

Beat-level consequences also exist. `Beat.onShow` can apply consequences when a beat is displayed, which is useful for recording discoveries, entering a dangerous space, setting information-ledger state, or marking that a visible event occurred.

Narrative integration:

- Minor consequences should usually create callbacks or subtle tints.
- Major consequences should alter route, relationship posture, future options, or ending eligibility.
- Delayed consequences are the main "butterfly effect" mechanism.
- Every state change that matters should eventually become visible residue.

Technical map:

- Consequence types live in `consequences.ts`.
- Beat-level `onShow` lives on `Beat` in `content.ts`.
- `gameStore.applyConsequences` applies immediate changes and returns `AppliedConsequence` hints.
- `normalizeConsequenceShape` tolerates some generated legacy shapes.
- `queueDelayedConsequence` appends to `pendingConsequences`.
- `loadScene` increments scene delays, checks trigger conditions, fires due delayed consequences, and surfaces butterfly feedback.
- `ConsequenceBudgetValidator` classifies consequence weight.

## Flags, Scores, and Tags

StoryRPG uses a three-layer state architecture.

| Layer | Shape | Best use |
|---|---|---|
| Flags | Boolean map | One-time events, route state, binary facts. |
| Scores | Integer map | Accumulating reputation, danger, resources, faction pressure. |
| Tags | Set | Identity markers, learned facts, social labels, flexible affordances. |

Narrative integration:

- Flags are good for "did this happen?"
- Scores are good for thresholds and gradual pressure.
- Tags are good for identity and category membership.
- State should not be write-only; if a flag is set, later story should read it or acknowledge it.

Technical map:

- State lives in `PlayerState.flags`, `.scores`, and `.tags`.
- Conditions read all three.
- Consequences write all three.
- Callback and flag validators check whether state gets used.
- Structural branch flags include `route_` and `treatment_branch_` prefixes.
- Tint flags use `tint:` and feed identity.

## Identity System

Identity is a hidden profile of who the protagonist is becoming.

Input sources:

- Tint flags from dilemma or identity-heavy choices.
- Tags inferred from choice language.
- Repeated behavior patterns.
- Relationship and route decisions, through authored consequences.

Output surfaces:

- Identity-gated choices.
- Different text variants.
- NPC reactions.
- Growth consequences.
- Ending route logic.
- Changed climactic choice meaning.

Technical map:

- `applyIdentityShifts` in `identityEngine.ts` maps tint flags and tag keywords to profile deltas.
- `getDominantTraits` labels axes with absolute value at or above the dominant threshold.
- `identityMeetsCondition` and `conditionEvaluator` support identity gating.
- `computeIdentityGrowth` maps identity movement to attribute growth at episode boundaries.
- `gameStore.applyConsequences` applies identity shifts after every consequence batch.

## Relationship System

Relationships are multi-dimensional. The four dimensions combine into different story postures:

- Trust: reliability.
- Affection: warmth.
- Respect: competence/status.
- Fear: danger/intimidation.

Narrative integration:

- High trust can unlock vulnerability, aid, or private information.
- High affection can produce warmth, concern, or emotional risk.
- High respect can unlock competence-based alliances even without warmth.
- High fear can produce compliance, avoidance, escalation, or betrayal.
- Low trust but high respect is dramatically different from high affection but high fear.

Technical map:

- Relationships initialize from `Story.npcs[].initialRelationship`.
- Relationship consequences are clamped to valid ranges by `gameStore.applyConsequences`.
- Relationship conditions gate content.
- `deriveRelationshipStance` in `relationshipStance.ts` maps relationship shapes to dialogue tone, visual blocking, encounter behavior, and callback posture.
- `RelationshipPacingContract` and `RelationshipPacingValidator` prevent unearned relationship labels.

## Inventory and Items

Items are narrative tools with optional hidden mechanical effects.

Item uses:

- Direct conditions: has item / minimum quantity.
- Consequences: add/remove item.
- Prepared advantages: item state reduces difficulty or opens options.
- Story tokens: a letter, key, proof, badge, debt marker, or relic.
- Identity markers: what the protagonist carries says something about them.

Technical map:

- `InventoryItem` lives in `player.ts`.
- `ItemCondition` lives in `conditions.ts`.
- `AddItem` and `RemoveItem` live in `consequences.ts`.
- `gameStore.hasItem`, `addItem`, and `removeItem` provide helper actions.

## Encounter System

Encounters are the tactical gameplay layer. They create pressure through clocks, choices, outcomes, and visible costs.

Core encounter systems:

- Encounter type/style.
- Goal, threat, and optional complication clocks.
- Phases and encounter beats.
- Choices with primary skills, approaches, outcome tiers, and next situations.
- Environmental elements.
- NPC states and tells.
- Escalation triggers.
- Terminal outcomes: victory, partial victory, defeat, escape.
- Storylets and aftermath.

Narrative integration:

- The goal clock is what the protagonist is trying to make happen.
- The threat clock is what worsens if they stumble or delay.
- Complicated success should fill both progress and cost.
- Partial victory must make the price visible.
- Defeat should create playable aftermath, not stop the story.
- Encounter outcome flags and storylets should affect reconvergence scenes.

Technical map:

- Encounter types are in `encounter.ts`.
- Runtime state is `EncounterState` in `encounterStatePersistence.ts`.
- `gameStore.startEncounter`, `addGoalProgress`, `addThreatProgress`, `recordOutcome`, `checkEscalationTriggers`, and related actions update runtime encounter state.
- `computeEncounterWeights` in `resolutionEngine.ts` resolves encounter choice weights.
- `buildEncounterConsequencePayload` adds encounter memory flags and outcome/cost consequences.
- `EncounterArchitect.ts` authors encounter content.
- `EncounterQualityValidator` and final validators enforce playability.

## Branch and Route State

Gameplay state can alter route at three levels:

- Beat routing: `Choice.nextBeatId` or beat `nextBeatId`.
- Scene routing: `Choice.nextSceneId`, `Scene.leadsTo`, scene conditions, fallback scenes.
- Episode routing: unlock conditions and route metadata.

Narrative integration:

- Route changes should create a different experience, not just a hidden flag.
- Reconvergence must acknowledge route residue.
- Route-gated content should feel like a result of the player's choices.

Technical map:

- `storyEngine.getNextScene` handles default routing.
- `storyEngine.getSceneById` handles explicit target scenes and fallback chains.
- `isTerminalSceneTarget` recognizes terminal scene ids like `episode-end`.
- `getPlayableEpisodes` hides inactive route siblings.
- `gameStore.recordBranchChoice` stores branch history and tone.

## Templates and Text Variants

Templates and variants make prose responsive without regenerating it during play.

Templates replace dynamic tokens such as:

- Character name.
- Pronouns.
- Story/NPC references.

Text variants choose alternate prose based on conditions.

Narrative integration:

- Variants are ideal for callbacks, relationship posture, route residue, outcome text, and clue payoffs.
- Templates should make prose personal but never expose raw internal names.
- Unresolved tokens should not reach the player.

Technical map:

- `processTemplate` and `processText` live in `templateProcessor.ts`.
- `storyEngine.processBeat` applies text variants and templates.
- Unresolved `{{...}}` tokens are replaced with the player character name and counted for observability.
- `TextVariant` can carry callback and residue ids.

## Visit Log, Recap, and Progress

The runtime records what the player actually saw and chose.

Tracked progress:

- Beat visits.
- Choice commits.
- Episode completions.
- Beats/scenes visited.
- Completed episode ids.

Narrative integration:

- Recaps can show the path the player took.
- Rewind/flowchart features can reason from actual visits.
- Future systems can distinguish authored content from experienced content.

Technical map:

- `VisitRecord` and `EpisodeCompletion` live in `player.ts`.
- `gameStore.visitBeat` appends visit records.
- `gameStore.commitChoice` attaches choices to the latest matching beat visit.
- `gameStore.completeEpisode` creates completion summaries.

## Generation-Time Gameplay Planning

Gameplay starts before runtime. The generator plans where choices, encounters, residue, and mechanics should appear.

Planning concepts:

- Season choice moments.
- Consequence budgets.
- Scene-first planning.
- Encounter-first planning.
- Mechanic pressure contracts.
- Residue obligations.
- Branch/consequence contracts.
- Treatment field obligations.

Narrative integration:

- The planner decides where mechanics should matter.
- The writers dramatize those mechanics as prose and choices.
- Validators check that the final story did not leave mechanics as metadata-only.

Technical map:

- `SeasonPlan.choiceMoments` and `residuePlan` live in `seasonPlan.ts`.
- `PlannedScene`, `SeasonScenePlan`, and `MechanicPressureContract` live in `scenePlan.ts`.
- `MechanicPressureContract` records domain, mechanic reference, function, story pressure, required evidence, visible residue, allowed/blocked payoffs, payoff windows, and required prerequisites.
- `SeasonPlannerAgent.ts`, `StoryArchitect.ts`, `SceneWriter.ts`, `ChoiceAuthor.ts`, and `EncounterArchitect.ts` build the generated story.
- `NarrativeMechanicPressureValidator` checks that hidden mechanics have visible story pressure.

## Validation Coverage

Gameplay is protected by validators at multiple stages:

- Season stage: seven-point coverage, promise, information, character architecture.
- Architecture stage: treatment fidelity, dramatic structure, theme pressure, scene turns.
- Quick validation: NPC depth, choice impact, mechanical storytelling, stat check balance, stakes, choice density/distribution, consequence budget, mechanics leakage.
- Full validation: skill coverage, skill surface, branch mechanical divergence, Pixar principles, cliffhanger.
- Diagnostics: setup/payoff, twist quality, arc delta, divergence, callback coverage, failure modes, choice coverage.
- Final gate: structural autofix, final story contract, encounter quality, promise/canon consistency, treatment fidelity, scene transition, scene turn, relationship pacing, narrative mechanic pressure, treatment field utilization, season promise, character treatment, failure-mode realization.

Technical map:

- Registry is `storyrpg-prototype/src/ai-agents/validators/validatorRegistry.ts`.
- Base result types are in `BaseValidator.ts`.
- Blocking gates must have remediation or be explicitly policy-allowlisted.

## End-to-End Runtime Flow

The main runtime loop is:

```text
Load story
  -> initialize player state
  -> load episode
  -> load scene
  -> process beat against player state
  -> render prose/media/choices
  -> player advances or chooses
  -> execute choice
  -> apply consequences
  -> queue delayed consequences
  -> route to beat/scene/episode
  -> fire delayed consequences on later scene loads
  -> complete episode
```

Important details:

- Conditions are rechecked when executing a choice.
- Stat checks add use-based growth consequences.
- Outcome flags are injected for conditional prose.
- Scene loads process pending delayed consequences.
- Branch history and visit log are persisted.
- The reader remains local/client-side during playback.

## Completeness Checklist

When auditing gameplay/narrative integration, confirm:

- Attributes exist and are hidden.
- Skills have fiction-first surfaces.
- Conditions gate choices, scenes, episodes, modifiers, and variants.
- Choices define type, intent, impact, stakes, and consequence tier where meaningful.
- Resolution has success, complicated, and failure outcomes.
- Consequences are applied, normalized, queued, and fired correctly.
- Flags/scores/tags are both written and read.
- Identity shifts through tint flags/tags and later affects content.
- Relationships move across trust, affection, respect, and fear.
- Inventory affects story through conditions, consequences, and advantages.
- Encounters use clocks, approaches, outcome tiers, costs, and storylets.
- Routes alter experienced content and preserve residue.
- Templates and variants produce responsive prose.
- Visit/choice history supports recaps and path understanding.
- Generation plans mechanics before prose.
- Validators cover both playability and story quality.
