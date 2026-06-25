# StoryRPG Story Concepts Guide

This guide explains the story concepts StoryRPG uses, from the reader-facing ideas to the generator/runtime contracts that make those ideas playable. It is meant to be readable by a designer, writer, producer, or engineer, with a deeper technical map at the end of each major section.

## Purpose

StoryRPG is not a freeform chatbot and it is not a visible-stat RPG. It is a structured interactive fiction system. The player reads image-backed prose, makes choices, and gradually sees the world, relationships, and protagonist change. The generator creates story material with a lot of hidden structure, but the reader experience should feel like authored fiction.

The core story promise is:

- The player experiences story beats one moment at a time.
- Choices shape the protagonist's identity, relationships, information, route, and future opportunities.
- Mechanics exist to keep cause and effect consistent, but they should appear as fiction.
- Generated stories use strong planning contracts so AI output feels intentional rather than improvised.

## Fiction-First Storytelling

Fiction-first is the master concept. The story world explains everything the player sees. Stats, checks, thresholds, routing flags, and validator metadata are hidden behind prose, staging, relationship behavior, and consequence.

Player-facing examples:

| Hidden concept | Fiction-first surface |
|---|---|
| Trust with an NPC decreased | The NPC stops volunteering information and keeps physical distance. |
| Courage helped a check | The protagonist steadies themself and steps into danger. |
| A route flag was set | Later scenes treat the protagonist as someone who chose that path. |
| Identity moved toward mercy | A mercy-shaped option, line, or reaction becomes available later. |
| A failed check occurred | The story gains a cost, complication, debt, exposure, or damaged trust. |

Fiction-first does not mean mechanics are weak. It means mechanics are translated into story language. A good StoryRPG scene never says "you failed the roll"; it says what broke, who noticed, what it cost, and what remains possible.

Technical map:

- Player-facing prose is processed by `storyrpg-prototype/src/engine/storyEngine.ts`.
- Raw mechanics leakage is guarded by `storyrpg-prototype/src/ai-agents/validators/MechanicsLeakageValidator.ts`.
- Mechanical story evidence is guarded by `MechanicalStorytellingValidator`, `NarrativeMechanicPressureValidator`, `SkillSurfaceValidator`, and the final contract validators.
- The canonical contract lives across `docs/STORY_QUALITY_CONTRACT.md`, `docs/GDD.md`, and `storyrpg-prototype/src/types/`.

## Story Hierarchy

StoryRPG content is organized as:

```text
Story
  Episode
    Scene
      Beat
        Choice
```

### Story

A `Story` is the whole playable unit. It contains title, genre, synopsis, cover image, initial player state, NPCs, and episodes. A story can be a single episode or a multi-episode season.

Important story concepts:

- Genre and tone: keep prose, choices, encounters, and visuals coherent.
- Initial state: starting attributes, skills, tags, and inventory.
- NPC roster: named characters with relationship dimensions and character metadata.
- Episodes: ordered playable chapters or scene-length route units.

### Episode

An `Episode` is a playable chapter. It should feel satisfying on its own while advancing the season. It can be a normal episode or, in route-heavy plans, a scene-length branch episode.

An episode usually includes:

- A starting scene.
- A local dramatic question.
- Several scenes that establish, pressure, turn, and pay off that question.
- At least one meaningful choice or encounter.
- Resolution plus forward pressure, such as a cliffhanger, cost, reveal, or changed relationship.

### Scene

A `Scene` is a location/situation unit: a confrontation, investigation, conversation, escape, ritual, aftermath, or encounter. Scenes are not just containers for prose. Modern generation attaches hidden contracts to scenes so validators can check whether the scene actually realized its dramatic work.

Scene-level concepts include:

- `startingBeatId`: where playback begins.
- `beats`: the visible prose sequence.
- `conditions`: whether the scene is available for the current player state.
- `fallbackSceneId`: what to load if conditions fail.
- `leadsTo`: possible default next scenes.
- `isBottleneck` and `isConvergencePoint`: branch-and-rejoin anchors.
- `branchType`: tonal memory for branch paths.
- `encounter`: optional tactical/multi-beat sequence.
- Generator-only contracts: scene turns, relationship pacing, mechanic pressure, treatment obligations, branch consequences, endings, character/world obligations, and stakes obligations.

### Beat

A `Beat` is the atomic reader moment. It is usually one compact prose unit with optional speaker, image, video/audio, conditional variants, on-show consequences, and choices.

Beat-level concepts include:

- Default prose (`text`).
- Conditional prose variants (`textVariants`).
- Speaker and mood.
- Image/audio/video references.
- Passive skill insights.
- Choice points.
- Thread plants and payoffs.
- Twist/reveal markers.
- Visual continuity, cast, coverage, and dramatic intent metadata.

Technical map:

- Canonical runtime types are in `storyrpg-prototype/src/types/story.ts`, `content.ts`, `choice.ts`, `conditions.ts`, `consequences.ts`, `encounter.ts`, `player.ts`, `seasonPlan.ts`, `sourceAnalysis.ts`, and `scenePlan.ts`.
- Runtime beat processing is in `storyrpg-prototype/src/engine/storyEngine.ts`.
- Reader state and persistence are in `storyrpg-prototype/src/stores/gameStore.ts` and `playerStatePersistence.ts`.
- Asset resolution uses `MediaRef` and `AssetRef`, with compatibility for legacy strings.

## Season-Level Story Structure

StoryRPG uses a season-level 3-act / 7-point structure. This is not visible to the player as labels. It is a planning spine that keeps long-form generated stories coherent.

The required seven beats are:

| Beat | Purpose |
|---|---|
| `hook` | Opens the promise, world, central pressure, and player curiosity. |
| `plotTurn1` | Pushes the protagonist across a threshold into the main story. |
| `pinch1` | Tightens cost, opposition, threat, or moral pressure. |
| `midpoint` | Recontextualizes the story and changes what the player thinks is happening. |
| `pinch2` | Narrows options and makes avoidance or old strategies fail. |
| `climax` | Forces the decisive confrontation, choice, or irreversible action. |
| `resolution` | Shows the changed state after the central pressure resolves. |

Two buffer roles also exist:

- `rising`: escalation between named beats before/around the midpoint.
- `falling`: aftermath and narrowing after midpoint/climax pressure.

The seven-point model matters because the generator needs a shared spine. Without it, AI-generated episodes can become episodic incidents that do not add up to a season.

Technical map:

- `StoryAnchors` and `SevenPointStructure` live in `storyrpg-prototype/src/types/sourceAnalysis.ts`.
- `StructuralRole` defines seven-point roles and buffer roles.
- `SourceMaterialAnalysis.anchors` and `.sevenPoint` are inferred or authored first.
- `SeasonPlan.anchors` and `.sevenPoint` carry the structure forward.
- `SeasonEpisode.structuralRole` tells downstream agents what each episode must carry.
- `storyrpg-prototype/src/ai-agents/utils/sevenPointDistribution.ts` deterministically maps beats onto any episode count and checks coverage/order.
- `SevenPointCoverageValidator` blocks incomplete or out-of-order season spines.
- `SevenPointAnchorConformanceValidator` and realization validators check that authored/treatment beats land in the correct episode and on-page.

## Source Analysis and Adaptation Mode

Before a generated season becomes scenes and beats, the pipeline analyzes the source material or prompt. This analysis is not just a summary; it is a contract for later agents.

Source analysis concepts include:

- Adaptation mode: source-faithful, inspired-by, or original.
- Story schema abstraction: reusable archetype, schema variables, and generalization guidance.
- Writing style guide: voice, diction, sentence rhythm, dialogue style, POV, imagery, pacing, do/avoid lists, and evidence.
- Direct language fragments: dialogue, prose, and terminology that should be preserved carefully when the source or treatment provides them.
- Character fashion/style: visual identity, signature garments, materials, palette, and accessories.
- Episode breakdown: per-episode synopsis, structural role, plot points, character involvement, choice estimate, and encounter needs.

Technical map:

- `SourceMaterialAnalysis` lives in `storyrpg-prototype/src/types/sourceAnalysis.ts`.
- `SourceMaterialAnalyzer.ts` creates analysis from prompts, documents, treatments, or source summaries.
- `WritingStyleGuide`, `StorySchemaAbstraction`, `DirectLanguageFragment`, and `CharacterFashionStyle` are source-analysis contracts consumed downstream.
- Treatment-specific extraction helpers live under `storyrpg-prototype/src/ai-agents/utils/`.

## Story Anchors

The four top-level anchors are:

- Stakes: what matters if the story goes wrong.
- Goal: what the protagonist is trying to accomplish.
- Inciting incident: the event that starts motion.
- Climax: the decisive confrontation or turning point.

Every episode, scene, choice, and consequence should be legible in relation to these anchors. For example, if the stakes are "the archive that keeps the dead remembered," a good midpoint does not merely add a new enemy; it changes the meaning of memory, the archive, or what survival will cost.

Technical map:

- Anchors live in `StoryAnchors`.
- `buildStructuralContextSection` in `storyrpg-prototype/src/ai-agents/prompts/storytellingPrinciples.ts` injects anchors and seven-point context into downstream agent prompts.
- Agents that consume the structural context include `StoryArchitect`, `SceneWriter`, `ChoiceAuthor`, `EncounterArchitect`, `BranchManager`, `ThreadPlanner`, `TwistArchitect`, `CharacterArcTracker`, and related specialists.

## Season Promise and Dramatic Engine

A season is not just a list of episodes. It has a promise: what kind of experience the story is offering and what must be emotionally complete by the end.

Season promise concepts include:

- Season dramatic question: the big question the season answers.
- Central pressure: the person, institution, mystery, environment, relationship, internal conflict, or situation applying force.
- Premise promise: what the setup tells the player this story will deliver.
- Player experience promise: what kinds of actions, dilemmas, or feelings the player should repeatedly encounter.
- Emotional promise: the emotional shape the story is selling.
- Variation plan: how episodes keep that promise fresh instead of repeating the same situation.
- Season completeness: what must be resolved or changed by the ending.

Technical map:

- `SeasonPromiseArchitecture` lives in `storyrpg-prototype/src/types/seasonPlan.ts`.
- `SeasonPromiseRealizationContract` turns top-level promises into scene/choice/encounter/final-prose obligations.
- `SeasonPromiseValidator` and `SeasonPromiseRealizationValidator` check whether these promises stay visible.

## World and Location Concepts

Worldbuilding in StoryRPG is not encyclopedia material. It exists to create playable pressure: rules, taboos, power structures, dangers, social expectations, locations, and costs that choices can touch.

World/location concepts include:

- World premise and time period.
- Genre, supernatural, technological, social, or political rules.
- Costs and taboos.
- Factions and power structures.
- Key locations with purpose, mood, history, and choice pressure.
- Location introductions: when the player first meaningfully understands a place.

A strong location is not just a backdrop. It changes what choices are possible, what risks matter, who has leverage, and what images need to show.

Technical map:

- World/location treatment guidance lives in `WorldLocationTreatmentGuidance` and `WorldLocationTreatmentLocationGuidance` in `sourceAnalysis.ts`.
- `WorldTreatmentRealizationContract` lives in `scenePlan.ts`.
- `SeasonPlan.worldTreatmentContracts` and `Scene.worldTreatmentContracts` carry world obligations.
- `WorldBuilder.ts` establishes setting, factions, rules, and locations.
- `WorldTreatmentRealizationValidator` checks that authored setting/location rules become on-page story pressure.

## Scenes as Dramatic Turns

A scene should have a turn: something changes. The change can be plot, leverage, knowledge, trust, risk, proximity, identity, resource, power, or emotional state.

Good scene language:

- Before state: what is true when the scene starts.
- Turn event: the reveal, action, choice, collision, or consequence that bends the scene.
- After state: what is true afterward that was not true before.
- Handoff: what pressure moves the player into the next beat, scene, encounter, or episode.

This prevents generated scenes from becoming summaries or conversations that merely mention plot points.

Technical map:

- `SceneTurnContract` lives in `storyrpg-prototype/src/types/scenePlan.ts`.
- `SceneWriter` is prompted to write scenes around turn contracts, stakes ladders, choice pressure, visual sequence intent, and forward pressure.
- `SceneTurnContractValidator` checks architecture-stage contracts.
- `SceneTurnRealizationValidator` checks final on-page realization.

## Cliffhanger and Episode Ending Concepts

Episodes should end with enough resolution to satisfy the immediate episode tension and enough forward pressure to make the next episode feel necessary.

Cliffhanger concepts include:

- Resolved episode tension: what the episode actually paid off.
- New open question: what remains unresolved or newly dangerous.
- Emotional charge: the feeling the ending leaves in the reader.
- Next episode pressure: why the next episode must happen.
- Cliffhanger type and intensity.
- Handoff causality: how this ending causes or pressures the next episode.

A cliffhanger is not only a shock ending. It can be a reveal, cost, changed relationship, new danger, vow, betrayal, opportunity, or quiet emotional rupture.

Technical map:

- `CliffhangerPlan` lives in `seasonPlan.ts`.
- Episode treatment fields such as `resolvedEpisodeTension`, `cliffhangerHook`, `cliffhangerQuestion`, `nextEpisodePressure`, `emotionalCharge`, and `endStateChange` live in `TreatmentEpisodeGuidance`.
- `CliffhangerValidator` and final story contract checks evaluate weak endings and repair/gate depending on configuration.

## Character Architecture

StoryRPG treats character as pressure under choice, not a static profile. The protagonist and supporting characters have architecture that guides how scenes and choices affect them.

### Protagonist Architecture

The protagonist architecture includes:

- Lie: the false or protective belief driving behavior.
- Origin pressure: the event, conditioning, survival adaptation, deprivation, or wound that made the lie useful.
- Truth: what the protagonist must recognize or refuse.
- Want: conscious goal.
- Need: deeper dramatic necessity.
- Arc mode: positive, tragic, or ambiguous.
- Climax choice: the decision that lets the protagonist integrate the truth or recommit to the lie.

This should remain invisible as labels. The player should feel it through choices, costs, NPC reactions, and climactic pressure.

### Supporting Character Micro-Arcs

Supporting characters can have:

- Micro-lie or defensive belief.
- Counter-pressure or truth.
- Screen-time tier.
- Pressure role: mirror, foil, temptation, warning, ally, antagonist.
- Visible signals that the protagonist can notice.
- Planned resolution.

An NPC is not just "friendly" or "hostile." They can mirror the protagonist, tempt them toward a route, challenge their values, or show a warning version of their future.

Technical map:

- `CharacterArchitecture`, `ProtagonistCharacterArchitecture`, and `SupportingCharacterMicroArc` live in `sourceAnalysis.ts`.
- `SeasonPlan.characterArchitecture` carries the plan.
- `CharacterArcTracker.ts` creates targets for identity and relationship movement.
- `CharacterTreatmentRealizationContract` tracks authored protagonist/core-character obligations.
- `ArcDeltaValidator`, `CharacterArchitectureValidator`, and `CharacterTreatmentRealizationValidator` check whether character movement is planned and realized.

## Identity Concepts

The player character has a hidden identity profile with six axes:

| Axis | Negative side | Positive side |
|---|---|---|
| `mercy_justice` | Mercy | Justice |
| `idealism_pragmatism` | Idealism | Pragmatism |
| `cautious_bold` | Cautious | Bold |
| `loner_leader` | Loner | Leader |
| `heart_head` | Heart | Head |
| `honest_deceptive` | Honest | Deceptive |

These are not moral rankings. They are expressive dimensions. A merciful protagonist is not "better" than a just one; a pragmatic protagonist is not "worse" than an idealistic one. The game uses the axes to notice patterns and open story-appropriate affordances.

Identity changes through:

- Tint flags, such as `tint:mercy` or `tint:pragmatism`.
- Tags inferred from choices.
- Dilemma choices that put values in conflict.
- Later gates that read established identity.
- NPC and ending logic that reacts to who the protagonist has become.

Technical map:

- Identity type is `IdentityProfile` in `player.ts`.
- Tint mapping is in `storyrpg-prototype/src/engine/identityEngine.ts`.
- Identity shifts are applied from consequences in `gameStore.applyConsequences`.
- Identity conditions are evaluated by `conditionEvaluator.ts`.
- Identity can drive growth through `computeIdentityGrowth`.

## NPC Relationship Concepts

Relationships use four dimensions:

| Dimension | Meaning |
|---|---|
| Trust | Does the NPC believe the protagonist will keep faith or tell the truth? |
| Affection | Does the NPC personally like or care about the protagonist? |
| Respect | Does the NPC value the protagonist's competence, judgment, or strength? |
| Fear | Does the NPC consider the protagonist dangerous? |

This four-dimensional shape creates richer behavior than a single "like" meter. An NPC can respect but distrust the protagonist, fear but need them, love but challenge them, or trust them without affection.

Relationship concepts include:

- Initial relationship state from story NPC definitions.
- Relationship consequences from choices.
- Relationship-gated choices or scenes.
- Relationship pacing stages, which prevent premature labels like "trusted ally."
- Relationship stance, which translates scores into dialogue tone, blocking, encounter behavior, and callback posture.

Technical map:

- `Relationship` lives in `player.ts`.
- NPC definitions live on `Story.npcs` in `story.ts`.
- Relationship consequences use `Consequence.type === 'relationship'`.
- `relationshipStance.ts` derives stance profiles from trust/affection/respect/fear.
- `RelationshipPacingContract` lives in `scenePlan.ts`.
- `RelationshipPacingValidator` checks that earned labels match visible evidence.

## Information, Mystery, and Setup/Payoff

StoryRPG tracks information as a story resource. The player, protagonist, allies, antagonists, and world can know different things at different times.

Information concepts include:

- Audience knowledge state: shared, withheld, or selective.
- Tension mode: suspense, mystery, dramatic irony, surprise, revelation, foreshadowing.
- Setup: when a clue, question, promise, or factual atom first appears.
- Reveal: when its meaning becomes legible.
- Payoff: when the story spends it.
- Box questions: open questions that should eventually close or transform.

This is especially important for generated stories, because LLMs often reveal too early, forget setups, or pay off unplanted facts.

Technical map:

- `InformationLedgerEntry` lives in `sourceAnalysis.ts`.
- `NarrativeThread`, `ThreadLedger`, plants, and payoffs live in `narrativeThread.ts`.
- `ThreadPlanner.ts` plans setup/payoff threads.
- `TwistArchitect.ts` plans reversals, revelations, betrayals, and reframes.
- `SetupPayoffValidator`, `TwistQualityValidator`, `InformationLedgerScheduleValidator`, and callback validators check these structures.

## Choices as Story Concepts

A choice is not simply a menu. It is the moment where the player interprets pressure and commits to a value, tactic, relationship posture, or route.

Choice concepts include:

- Choice type: expression, relationship, strategic, dilemma.
- Choice intent: flavor, branching, blind, dilemma.
- Impact factors: outcome, process, information, relationship, identity.
- Stakes: want, cost, identity.
- Consequence tier: callback, scene tint, branchlet, structural branch.
- Affordance source: identity, relationship, tag, item, skill, flag, callback.
- Reminder plan: immediate, short-term, and later echoes.
- Residue hints: what should remain visible after the choice.
- Witness reactions: how NPCs remember and interpret the action.
- Failure residue: debt, suspicion, injury, lost leverage, exposure, obligation, damaged trust, or position shift.

Technical map:

- `Choice` is defined in `choice.ts`.
- `ChoiceAuthor.ts` authors playable options from scene plans.
- `ChoiceImpactValidator`, `FiveFactorValidator`, `StakesTriangleValidator`, `ChoiceCoverageValidator`, `ChoiceDensityValidator`, `ChoiceDistributionValidator`, and `ConsequenceBudgetValidator` validate choice quality and distribution.

## Consequence and Residue Concepts

Consequences are state changes. Residue is how those state changes remain meaningful in fiction.

Immediate consequences can:

- Change attributes or skills.
- Shift relationships.
- Set or clear flags.
- Change scores.
- Add/remove tags.
- Add/remove inventory.
- Route to a scene or beat.

Delayed consequences can:

- Fire after scenes or episodes.
- Fire when a trigger condition becomes true.
- Reintroduce prior choices as callbacks, costs, advantages, or altered relationships.

Residue can surface as:

- Conditional prose.
- Changed NPC behavior.
- Prepared advantages.
- Locked/unlocked choices.
- Visual staging.
- Encounter complications.
- Branch reconvergence acknowledgements.
- Ending eligibility.

Technical map:

- Consequence types live in `consequences.ts`.
- Delayed consequences are queued in `PlayerState.pendingConsequences`.
- `gameStore.loadScene` advances delayed consequence clocks and fires due effects.
- Season-level residue lives in `SeasonResidueObligation` in `seasonPlan.ts`.
- `ResidueObligationValidator`, `CallbackCoverageValidator`, `CallbackOpportunitiesValidator`, and `NarrativeMechanicPressureValidator` help enforce residue.

## Season Canon Concepts

Season canon is the sealed memory of what has become true across episodes. It prevents later episodes from contradicting earlier episodes or giving characters knowledge they should not have.

Canon concepts include:

- Promise ledger: setups, payoffs, and due episodes.
- Season canon: append-only record of established facts, state, and knowledge.
- Episode state snapshot: what was true after an episode sealed.
- Season progress: which episodes are generated, sealed, and safe to build on.
- Knowledge-state consistency: who knows what, when, and why.

Canon is especially important for incremental generation. The model can propose new material, but the canon decides whether that proposal is allowed.

Technical map:

- Canon architecture is described in `docs/SEASON_CANON_ARCHITECTURE.md`.
- Promise ledger validators live in `storyrpg-prototype/src/ai-agents/validators/promiseLedgerValidators.ts`.
- Canon consistency checks live in `canonConsistencyValidator.ts`.
- `CallbackLedger` and related pipeline utilities track setup/payoff and callback memory.
- The validator registry marks `PromiseLedgerValidators` and `CanonConsistencyValidator` as final blocking gates for episode sealing.

## Encounters as Story Concepts

Encounters are tactical story set pieces. They can be combat, chase, heist, negotiation, investigation, survival, social, romantic, dramatic, puzzle, exploration, stealth, or mixed.

An encounter is a scene kind, not a separate story format. It intensifies story pressure through action, clocks, outcomes, and aftermath.

Encounter concepts include:

- Goal clock: what the protagonist is trying to accomplish.
- Threat clock: the escalating danger.
- Phases: setup, rising, peak, resolution.
- Approaches: aggressive, cautious, clever, desperate, adaptive.
- Outcome tiers: success, complicated, failure.
- Terminal outcomes: victory, partial victory, defeat, escape.
- Costs: relationship, injury, resource, time, exposure, reputation, information, position, world, or mixed.
- Storylets: short aftermath sequences for encounter outcomes.
- Payoff context: flags, relationships, identity, skill, inventory, prior failure, and promise payoffs.

Technical map:

- Encounter types live in `encounter.ts`.
- `EncounterArchitect.ts` authors encounters.
- Runtime encounter state is in `encounterStatePersistence.ts` and `gameStore.ts`.
- Encounter consequences are built by `encounterConsequences.ts`.
- `EncounterQualityValidator`, `EncounterAnchorContentValidator`, and final contract checks validate encounter quality and story fit.

## Branching and Reconvergence Concepts

StoryRPG uses branch-and-bottleneck structure:

```text
Bottleneck -> Branch Zone -> Reconvergence/Bottleneck -> Branch Zone -> Resolution
```

Branch concepts include:

- Choice branches: direct player route choice.
- Encounter branches: earned outcome through tactical play.
- Conditional branches: automatic route based on state.
- Cross-episode branches: path state that affects later episodes.
- Route-gated episodes: sibling branch episodes only visible when conditions pass.
- Reconvergence: branches rejoin while preserving visible residue.
- Convergence points: scenes where multiple paths meet.

Reconvergence is not erasure. A reconverged story still remembers how the player arrived.

Technical map:

- Runtime route fields are `Choice.nextSceneId`, `Choice.nextBeatId`, `Scene.leadsTo`, `Scene.conditions`, `Episode.unlockConditions`, and `Episode.routeMeta`.
- `storyEngine.getNextScene`, `getSceneById`, and playable episode helpers resolve routes.
- `gameStore.recordBranchChoice` stores branch history and branch tone.
- `SceneGraphBranchValidator`, `DivergenceValidator`, `BranchMechanicalDivergenceValidator`, `EndingReachabilityValidator`, and final contract checks validate branches.

## Visual and Audio Story Concepts

Visuals are story meaning, not decoration. A beat image should show action, emotion, relationship, cost, clue, or consequence.

Visual concepts include:

- Media references: image/audio/video assets attached to beats and scenes.
- Visual moment: what the image should communicate.
- Primary action: what is physically happening.
- Emotional read: what the character state looks like.
- Relationship dynamic: proximity, power, distance, or tension.
- Coverage plan: shot distance, focal characters, staging pattern, camera side, blocking, and continuity.
- Visual cast: which characters are visible, offscreen, active, addressed, or observing.
- Sequence intent: how consecutive panels read as setup -> pressure -> turn -> consequence.

Audio/narration is optional and should support the reading experience without becoming required for comprehension.

Technical map:

- Visual beat fields live in `content.ts`.
- Scene-level visual plans live in `SceneVisualSequencePlan`.
- Image generation and QA live under `storyrpg-prototype/src/ai-agents/agents/image-team/`.
- Audio generation is optional and routed through narration/audio services.

## Treatment and Source-Fidelity Concepts

When a user provides a treatment or source material, authored details become binding story obligations. The generator should expand the treatment, not rewrite it into a different story.

Treatment concepts include:

- Authored episode turns.
- Signature devices or images.
- Encounter anchors.
- Stakes layers.
- Theme angles.
- Lie pressure.
- Major choice pressures.
- Alternative paths.
- Information movement.
- Consequence seeds and residue.
- Ending turnout.
- Failure-mode audit claims.

Technical map:

- Treatment guidance types live in `sourceAnalysis.ts`.
- Treatment-derived contracts live in `scenePlan.ts`.
- `StoryArchitect` maps treatment obligations into scenes, choices, and encounters.
- Fidelity validators include `AuthoredEpisodeConformanceValidator`, `TreatmentFieldUtilizationValidator`, `RequiredBeatRealizationValidator`, `TreatmentSeedOnPageValidator`, `CharacterTreatmentRealizationValidator`, `WorldTreatmentRealizationValidator`, `InformationLedgerScheduleValidator`, and related final contract checks.

## Completeness Checklist

Use this checklist when asking whether a story concept has been represented:

- Story hierarchy: story, episode, scene, beat, choice.
- Fiction-first rule: no raw mechanics in player-facing prose.
- Seven-point season spine: all seven beats covered in order.
- Four anchors: stakes, goal, inciting incident, climax.
- Season promise: experience, emotion, variation, completeness.
- Scene turn: before state, turn event, after state, handoff.
- Character architecture: lie, want, need, truth, climax choice.
- Supporting character pressure roles.
- Player identity axes and tint/tag shifts.
- NPC relationship dimensions and pacing.
- Information ledger, threads, clues, reveals, payoffs.
- Choice type, intent, impact, stakes, consequence tier.
- Immediate consequences, delayed consequences, and residue.
- Encounter clocks, phases, approaches, outcomes, costs, storylets.
- Branching, reconvergence, route state, and cross-episode residue.
- Visual storytelling metadata and asset references.
- Treatment/source obligations and validator coverage.
