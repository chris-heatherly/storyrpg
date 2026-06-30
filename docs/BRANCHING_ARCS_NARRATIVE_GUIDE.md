# Branching, Character Arcs, and Narrative Integration Guide

This guide explains how branching works in StoryRPG and how it intersects with player identity, NPC arcs, relationship movement, and long-form narrative structure.

## Branching Philosophy

StoryRPG does not try to create infinite story trees. Infinite branching is expensive, brittle, and usually weakens authored payoff. Instead, the game uses controlled divergence:

```text
Shared story pressure
  -> meaningful branch
  -> different experience / state / relationship / information
  -> reconvergence
  -> visible residue remains
```

The key is not permanent separation. The key is that the player's path changes what happens, how it happens, what is known, who trusts whom, who the protagonist becomes, and what future options mean.

## Branching Is Not a Choice Type

In the codebase, branching is a routing/mechanical property, not a player-experience category.

Choice type answers: "What kind of decision does this feel like?"

- Expression.
- Relationship.
- Strategic.
- Dilemma.

Branching answers: "Does this decision route the player to a different beat, scene, episode, outcome, or future state?"

That means:

- Expression choices should not branch.
- Relationship choices can branch.
- Strategic choices can branch.
- Dilemma choices can branch.
- Encounter outcomes can branch.
- Conditions can route the player without a fresh choice.

Technical map:

- `ChoiceType` and `ChoiceIntent` are in `choice.ts`.
- Player-driven scene branching uses `Choice.nextSceneId`.
- Same-scene routing uses `Choice.nextBeatId`.
- Conditional default routing uses `Scene.leadsTo` plus `Scene.conditions`.
- Route-gated episode visibility uses `Episode.unlockConditions` and `Episode.routeMeta`.
- `ChoiceImpactValidator` errors when flavor/expression choices branch.

## Branch Types

### Choice Branches

A choice branch happens when the player selects an option that routes to a different scene or beat.

Narrative use:

- Different plan of action.
- Different ally or opponent.
- Different emotional posture.
- Different information path.
- Different cost.

Technical use:

- `Choice.nextSceneId` points to a scene.
- `Choice.nextBeatId` can point to a bridge/payoff beat.
- Consequences set flags, scores, tags, relationships, items, or route state.

### Encounter Branches

An encounter branch happens when tactical play produces different outcomes.

Narrative use:

- Victory, partial victory, defeat, or escape.
- Different visible costs.
- Different NPC memory.
- Different aftermath storylet.
- Changed leverage in reconvergence.

Technical use:

- Encounter choices have success/complicated/failure outcomes.
- Terminal outcomes can set `encounterOutcome`.
- `buildEncounterConsequencePayload` creates encounter memory flags.
- Encounter storylets and outcome-conditioned variants carry the result forward.

### Conditional Branches

A conditional branch happens when the system routes based on accumulated state.

Narrative use:

- A scene exists only if an ally trusts the protagonist.
- A route opens because an item was acquired.
- A prior failure causes a harder arrival.
- An identity path reveals a distinct line of action.

Technical use:

- Conditions read attributes, skills, relationships, flags, scores, tags, items, and identity.
- `getNextScene` selects the first valid `leadsTo` target.
- `fallbackSceneId` prevents dead ends when a scene is unavailable.

### Cross-Episode Branches

Cross-episode branches start in one episode and affect later episodes.

Narrative use:

- A saved NPC later helps or withholds help.
- A faction remembers the protagonist's allegiance.
- A clue changes how a later reveal lands.
- A route changes ending eligibility.

Technical use:

- `CrossEpisodeBranch`, `ConsequenceChain`, `seasonFlags`, and `SeasonResidueObligation` live in season-level types.
- Later episodes check flags, relationships, scores, tags, and residue obligations.
- Validators check whether planned branch state becomes on-page story material.

## Branch-and-Bottleneck Structure

StoryRPG uses a "string of pearls" pattern:

```text
Bottleneck -> Branch Zone -> Bottleneck -> Branch Zone -> Bottleneck
```

Bottlenecks are shared dramatic anchors. Branch zones create divergent experiences between them. Reconvergence keeps production manageable while preserving player agency.

A good bottleneck:

- Advances the season spine.
- Is reachable from valid paths.
- Acknowledges relevant route residue.
- Does not erase the player's path.

A good branch zone:

- Offers a real difference in action, information, relationship, or identity.
- Uses consequences that later content can read.
- Has a clear reconvergence plan.
- Does not skip required setup unless a bridge explicitly handles it.

Technical map:

- `Scene.isBottleneck` and `Scene.isConvergencePoint` mark runtime scenes.
- `Scene.branchType` carries tonal branch identity.
- `Scene.leadsTo` declares onward targets.
- `SceneGraphBranchValidator` checks route targets, bridge beats, branch fan-out, reconvergence, and missing residue.
- `DivergenceValidator` simulates episode paths to catch cosmetic branching.
- `BranchMechanicalDivergenceValidator` checks whether branch choices leave distinct mechanical residue.

## Route-Gated Episodes

StoryRPG can represent route branches as scene-length episodes. This keeps the reader's episode list clean by hiding inactive route siblings.

Narrative use:

- A branch path gets its own short playable unit.
- Only the player's active path appears.
- The route can later rejoin the main spine.

Technical map:

- `Episode.episodeStructureMode` can be `sceneEpisodes`.
- `Episode.routeMeta` uses the `EpisodeRouteMeta` shape: kind, spine index, optional branch group/path ids, branch step/length, rejoin spine index, display label, milestone encounter flag, and inactive visibility behavior.
- `Episode.routeMeta.kind` can be `master` or `branch`.
- `routeMeta.hideWhenInactive` controls visibility.
- `isEpisodeOnActiveRoute` and `getPlayableEpisodes` in `storyEngine.ts` filter episodes.
- `Episode.unlockConditions` determine whether the branch episode is active.

## Reconvergence

Reconvergence is where branches meet again. It is one of the most important story concepts in the system.

Bad reconvergence:

- Ignores the player's path.
- Uses the same dialogue regardless of outcome.
- Drops relationship changes.
- Pretends a failure did not happen.
- Erases a moral choice.

Good reconvergence:

- Preserves plot continuity.
- Acknowledges branch residue through prose, dialogue, choice wording, visual state, or NPC posture.
- Converts branch-specific state into shared forward pressure.
- Lets the same scene mean different things depending on how the player arrived.

Reconvergence surfaces:

- Text variants gated by route flags or encounter outcome flags.
- NPC relationship stance changes.
- Passive skill insights unlocked by prior information.
- Prepared stat-check modifiers.
- Different locked/unlocked options.
- Visual residue in staging, injuries, distance, props, or damage.
- Ending eligibility changes.

Technical map:

- Reconvergence can be explicit (`isConvergencePoint`) or structural (multiple incoming paths).
- Text variants use `ConditionExpression`.
- Branch history is stored in `gameStore.branchHistory`.
- Encounter outcome flags use `encounter.<id>.choice.<choiceId>.<tier>` and `encounter.<id>.outcome.<terminalOutcome>`.
- `SceneGraphBranchValidator` has specific checks for missing branch residue.
- `FinalStoryContractValidator` and fidelity validators catch final story failures.

## Branch Residue

Branch residue is the lasting evidence of a path.

Residue can be mechanical:

- A flag.
- A score change.
- A relationship shift.
- A tag.
- An item.
- A delayed consequence.
- A stat-check modifier.
- A route condition.
- An ending condition.

Residue can be narrative:

- A callback line.
- A changed line of dialogue.
- A scar, debt, injury, rumor, or suspicion.
- A change in how an NPC stands near the protagonist.
- A clue the protagonist can use.
- A cost that affects an encounter.
- A route-specific interpretation of a shared scene.

Technical map:

- Choice residue fields include `residueHints`, `witnessReactions`, `failureResidue`, `visualResidueHint`, `reminderPlan`, `feedbackCue`, `memorableMoment`, and consequences.
- Season-level residue uses `SeasonResidueObligation`.
- Scene-level hidden contracts include `branchConsequenceContracts` and `mechanicPressure`.
- `ResidueObligationValidator`, `CallbackCoverageValidator`, `CallbackOpportunitiesValidator`, and `NarrativeMechanicPressureValidator` protect residue.

## Player Character Arcs and Branching

Player character arcs emerge from repeated choices and branch consequences. The generator can plan a protagonist arc, but the player path determines how that pressure is expressed.

Key arc concepts:

- Lie: the belief or survival strategy under pressure.
- Want: the conscious goal.
- Need/truth: what growth requires.
- Identity axes: the player's actual behavior pattern.
- Climax choice: where the arc becomes unavoidable.

How branches affect player arcs:

- Expression choices establish voice and self-image.
- Dilemma branches move identity axes and tint future scenes.
- Strategic branches show how the protagonist solves problems.
- Relationship branches reveal what the protagonist is willing to risk for others.
- Failure branches can deepen humility, resolve, caution, or desperation.
- Route branches can make different versions of the climax feel earned.

Example:

```text
Branch A: The player protects an enemy witness.
  -> Sets mercy/idealism residue.
  -> An ally questions the risk.
  -> The witness later reveals a clue.
  -> The climax can frame mercy as costly but powerful.

Branch B: The player sacrifices the witness for mission safety.
  -> Sets justice/pragmatism or ruthlessness residue.
  -> The ally may respect the competence but lose trust.
  -> The missing clue forces a harsher later encounter.
  -> The climax can frame victory as efficient but morally lonely.
```

Both paths can reach the same final confrontation. They should not feel like the same protagonist.

Technical map:

- `IdentityProfile` tracks player identity.
- Tint flags and tags shift identity via `identityEngine.ts`.
- `CharacterArcTracker.ts` supplies target identity and relationship movements.
- `SceneWriter` accepts `identityDeltaHints` and `relationshipTrajectory`.
- `ArcDeltaValidator` checks whether choices move the protagonist toward planned arc targets.
- `CharacterTreatmentRealizationValidator` checks authored character obligations.

## NPC Arcs and Branching

NPC arcs are not only scripted. They intersect with the player's branch choices through relationship dimensions, pacing contracts, and callback behavior.

NPC branch effects can include:

- Trust gain/loss based on honesty, loyalty, or follow-through.
- Affection gain/loss based on kindness, intimacy, or rejection.
- Respect gain/loss based on competence, courage, or judgment.
- Fear gain/loss based on violence, threat, power, or unpredictability.
- Micro-arc progress when the player's actions challenge an NPC's lie or role.
- Changed encounter behavior when an NPC helps, hesitates, panics, betrays, or protects.

NPC arcs should honor pacing. A branch can create a spark, debt, or rupture immediately, but "trusted ally" should require enough evidence.

Technical map:

- NPC relationship state lives in `PlayerState.relationships`.
- NPC definitions live on `Story.npcs`.
- `RelationshipPacingContract` defines start/target stage, allowed labels, blocked labels, evidence, and max scene delta.
- `deriveRelationshipStance` maps relationship values to behavior posture.
- `RelationshipPacingValidator` checks earned labels and pacing.
- `CharacterIntroductionValidator` checks that important NPCs are introduced on-page before visual/prose use.

## Narrative Structure and Branching

Branches must serve the season's dramatic structure. They are not random side roads.

Branching by Story Circle role:

| Story Circle role | Strong branch function |
|---|---|
| You | Establish player posture, first values, and the promise of agency. |
| Need | Make the player feel the lack beneath the visible goal. |
| Go | Commit the protagonist to a route, alliance, debt, or irreversible threshold. |
| Search | Make prior choices cost something while testing adaptation. |
| Find | Recontextualize route assumptions or reveal the hidden meaning of a choice. |
| Take | Narrow options and force branch residue to matter. |
| Return | Let repeated identity/relationship/route patterns decide the available ending logic. |
| Change | Show the changed world and protagonist state. |

Branching by scene role:

- Setup scenes plant possible futures.
- Development scenes escalate branch pressure.
- Turn scenes force different commitments.
- Payoff scenes spend residue.
- Release scenes let consequences emotionally land.

Technical map:

- `SeasonEpisode.storyCircleRole` guides agents.
- `SceneNarrativeRole` in `scenePlan.ts` describes a scene's function within its episode.
- `StoryArchitect` plans choice points, branches, encounter scenes, and structural beat realization.
- `SceneWriter` turns the plan into beats, variants, and visible pressure.
- `ChoiceAuthor` authors options that carry stakes and consequences.

## Branching and Information

Information is one of the five choice impact factors. A branch can change what the player learns, when they learn it, who knows it, and what it means.

Good information branches:

- Give one path a clue and another path a different clue or cost.
- Delay a reveal on one path but compensate with relationship or resource leverage.
- Let dramatic irony differ from protagonist knowledge.
- Pay off earlier observation, skill, or trust.

Bad information branches:

- Reveal the same secret in the same words regardless of path.
- Let one path miss required setup with no alternate bridge.
- Pay off a clue that was never planted.
- Reveal hidden knowledge before the player/protagonist could know it.

Technical map:

- `InformationLedgerEntry` models knowledge states and timing.
- `TextVariant` and `callbackHookId` can pay information residue.
- `InformationLedgerScheduleValidator`, `SetupPayoffValidator`, `TwistQualityValidator`, and `CanonConsistencyValidator` protect information logic.

## Branching and Endings

Endings should be reachable through accumulated state, not arbitrary selection.

Ending drivers can include:

- Relationship state.
- Identity pattern.
- Flags.
- Encounter outcomes.
- Faction state.
- Theme position.
- Repeated choice pattern.
- Resource or information state.

Branches can:

- Open an ending route.
- Reinforce an ending route.
- Threaten or close an ending route.
- Recontextualize an ending's emotional meaning.

Technical map:

- `StoryEndingTarget` and `EndingStateDriver` live in `sourceAnalysis.ts`.
- `TreatmentBranchGuidance.pathVariants[].targetEndingIds` can connect branch paths to endings.
- `EndingRealizationContract` tracks finale obligations.
- `EndingReachabilityValidator` checks that declared ending-axis flags are set by choices.

## Runtime Branch Flow

The runtime flow for a choice branch is:

```text
Player sees processed beat
  -> choice list is filtered/locked by conditions
  -> player selects choice
  -> executeChoice checks conditions again
  -> stat check resolves if present
  -> consequences are collected
  -> outcome flags may be injected
  -> gameStore applies immediate consequences
  -> delayed consequences are queued
  -> branch choice is recorded if scene route changes
  -> reader loads next beat or next scene
  -> later text variants/conditions read the state
```

The runtime flow for default scene routing is:

```text
Current scene ends
  -> getNextScene checks currentScene.leadsTo
  -> first valid target scene wins
  -> skipped targets can follow fallbackSceneId
  -> if no leadsTo target works, use next sequential scene
  -> if no scene exists, episode ends
```

The runtime flow for active route episodes is:

```text
Story episode list
  -> check route metadata
  -> master episodes remain visible
  -> branch episodes are visible only when active/unlocked
  -> next playable episode skips inactive route siblings
```

Technical map:

- `processBeat`, `executeChoice`, `getNextScene`, `getSceneById`, `getPlayableEpisodes`, and `getNextPlayableEpisode` are in `storyEngine.ts`.
- `loadScene`, `recordBranchChoice`, `visitBeat`, and `commitChoice` are in `gameStore.ts`.
- Terminal targets such as `episode-end` are recognized by `isTerminalSceneTarget`.

## Generation Pipeline Branch Flow

The generation flow for branching is:

```text
Source analysis
  -> season plan
  -> season choice moments and residue plan
  -> episode architecture / scene plan
  -> scene prose
  -> choices
  -> encounters
  -> assembly
  -> validators and repairs
  -> final story package
```

How responsibilities split:

- `SeasonPlannerAgent` identifies season-level branch moments, cross-episode branches, consequence chains, route/ending pressure, and residue obligations.
- `SeasonPlannerAgent` can also create `SeasonScenePlan` slices so standard scenes and encounters are planned together at the season level.
- `StoryArchitect` plans the episode scene graph, choice points, branch scenes, encounter scenes, and reconvergence.
- `SceneWriter` writes beats that set up decisions, express incoming choice context, carry branch residue, and provide variants.
- `ChoiceAuthor` authors choices with impact factors, stakes, consequences, stat checks, route targets, and residue hints.
- `EncounterArchitect` authors tactical branching and outcome storylets.
- `BranchManager` and validators analyze topology and divergence.
- `FullStoryPipeline` assembles and enforces final contracts.

Scene-first branch planning:

- `PlannedScene.kind` distinguishes standard scenes from encounters.
- `SceneNarrativeRole` says whether a scene is setup, development, turn, payoff, or release.
- `ConsequenceTier` budgets whether a scene spends callback, tint, branchlet, or branch-level consequence weight.
- Branch and encounter scenes are part of one ordered spine, so pacing, setup/payoff, and residue can be reasoned about before prose generation.

## Validation and Failure Modes

Important branch failure modes:

- Missing branch: the plan said branch, but final choices are linear.
- Dead branch: choices all route to the same target.
- Invalid target: a choice points to a scene that does not exist.
- Backward/self branch: route loops or moves backward unsafely.
- Missing choice bridge: scene-skip branch lacks a bridge beat.
- Missing required setup: a branch skips setup scenes without permission.
- Cosmetic divergence: branches produce the same terminal experience.
- No residue: branch rejoins with no lasting mechanical or narrative difference.
- Unused flags: route state is written but never read.
- Premature NPC use: branch visuals/prose use important NPCs before introduction.
- Unearned relationship labels: branch calls someone an ally/friend too soon.
- Ending unreachable: an ending path is declared but no choice sets its required state.

Technical map:

- `SceneGraphBranchValidator` checks graph structure and branch fan-out.
- `DivergenceValidator` uses path simulation and experience fingerprints.
- `BranchMechanicalDivergenceValidator` checks route/residue signatures.
- `ChoiceImpactValidator` protects choice type/branch rules.
- `FlagContractValidator` checks flag semantics and usage.
- `EndingReachabilityValidator` checks ending route flags.
- `RelationshipPacingValidator` checks relationship claims.
- `NarrativeMechanicPressureValidator` checks mechanics-as-story evidence.

## Design Patterns

### The Meaningful Local Branch

Use when a choice should change the next scene but not the whole season.

Pattern:

```text
Choice sets route flag and routes to branch scene
  -> branch scene provides distinct action/information/relationship pressure
  -> reconvergence scene reads flag with text variant
  -> later callback references the branch once more
```

### The Encounter Outcome Branch

Use when success, partial success, failure, and escape should all be playable.

Pattern:

```text
Encounter outcome sets flags/consequences
  -> outcome storylet shows immediate cost/payoff
  -> reconvergence scene acknowledges outcome
  -> later scene spends cost or advantage
```

### The Character Arc Branch

Use when a decision defines who the protagonist is becoming.

Pattern:

```text
Dilemma choice sets tint/tag/relationship state
  -> NPC reacts according to value conflict
  -> future identity-gated option appears
  -> climax uses accumulated identity as available route/voice
```

### The NPC Trust Branch

Use when a bond changes available story leverage.

Pattern:

```text
Relationship choice shifts trust/affection/respect/fear
  -> immediate NPC behavior changes
  -> later scene gates aid or withheld information
  -> relationship stance changes dialogue/blocking
  -> branch payoff avoids instant intimacy unless evidence supports it
```

### The Information Branch

Use when different paths learn different truths.

Pattern:

```text
Branch A learns clue A
Branch B learns clue B or pays cost for missing clue
  -> midpoint/reveal text differs
  -> later decision has different available information
  -> both paths remain fair and playable
```

## Completeness Checklist

When auditing branching, confirm:

- Branching is distinguished from choice type.
- Expression/flavor choices do not branch.
- Meaningful branch choices have impact factors and stakes.
- Branches route to valid beats/scenes/episodes.
- Branches do not skip required setup without a bridge.
- Every branch has mechanical and/or narrative residue.
- Reconvergence acknowledges route, outcome, relationship, identity, or information differences.
- Cross-episode branches are represented in season plan state.
- Route-gated episodes hide inactive branch siblings.
- Encounter outcomes set flags and visible costs.
- Player identity axes can affect branch availability and meaning.
- NPC relationship dimensions can affect branch availability and behavior.
- Relationship pacing is earned on-page.
- Information branches preserve setup/reveal/payoff order.
- Ending routes are mechanically reachable.
- Validators cover topology, divergence, residue, choice impact, relationship pacing, and final contract.
