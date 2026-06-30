# Storytelling, Gameplay, Choice, and Branching Concept Inventory

Last audited: 2026-06-28

This inventory lists the storytelling, gameplay, and choice/branching concepts that currently exist as typed fields and/or are validated by the StoryRPG pipeline. It is code-first: the primary sources are the canonical types under `storyrpg-prototype/src/types/`, the validator registry and gate registry under `storyrpg-prototype/src/ai-agents/validators/` and `storyrpg-prototype/src/ai-agents/remediation/`, and the generation agents that carry those contracts.

## Status Legend

| Status | Meaning |
|---|---|
| Blocking | A failed check can stop generation or final packaging in the normal pipeline. |
| Blocking, default-on gate | The validator/check is gate-controlled and the gate currently defaults on. |
| Blocking-capable, default-off gate | The validator/check can block when enabled, but its gate currently defaults off. |
| Advisory | The concept is checked or scored, but failures normally surface as warnings/quality evidence rather than aborts. |
| Remediation/autofix | The concept is enforced by in-place repair, bounded regeneration, or soft repair rather than a direct hard abort. |
| Artifact/helper | The concept has a validator/helper used by artifacts, tests, diagnostics, or repair paths but is not a primary validator-registry gate. |
| Compatibility | The concept remains in fields or migration helpers for old artifacts/checkpoints, but it is not the active structural model. |

Important policy detail: the registry tier and the gate default are not identical. Some registry entries are marked `blocking` but are only active as blockers when their rollout gate is enabled. Conversely, some advisory validators feed default-on remediation or plan-time gate paths.

## Runtime Story Hierarchy

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Story | `Story.id`, `title`, `genre`, `synopsis`, `coverImage`, `author`, `tags`, `episodes`, `initialState`, `npcs` in `src/types/story.ts` | `FinalStoryContractValidator` is blocking; `StructuralValidator` autofixes some shape issues; `decodeStory` is an artifact/package check. |
| Episode | `Episode.id`, `number`, `title`, `synopsis`, `coverImage`, `scenes`, `startingSceneId`, `episodeCircle`, `unlockConditions`, `onComplete` | `FinalStoryContractValidator` blocks invalid runtime contracts; `EpisodeStoryCircleValidator` blocks missing episode Story Circle blueprint coverage. |
| Scene | `Scene.id`, `name`, `beats`, `startingBeatId`, `conditions`, `fallbackSceneId`, `leadsTo`, `isBottleneck`, `isConvergencePoint`, `branchType`, `timeline`, `encounter` | `SceneGraphBranchValidator` advisory by default, with `GATE_BRANCH_FANOUT` default-on for branch fan-out defects; `SceneSpineValidator` is artifact/helper; `SceneTransitionContinuityValidator` is blocking, default-on gate. |
| Beat | `Beat.id`, `text`, `textVariants`, `speaker`, `speakerMood`, `choices`, `nextBeatId`, `nextSceneId`, `onShow`, `isChoicePoint`, `isChoiceBridge`, `plantsThreadId`, `paysOffThreadId`, `plotPointType`, `twistKind` | `StructuralValidator` fixes missing `isChoicePoint`; `FinalStoryContractValidator` blocks broken routing/templates; `SetupPayoffValidator`, `TwistQualityValidator`, and callback validators audit thread/plot markers. |
| Conditional prose | `TextVariant.condition`, `text`, `sourceChoiceId`, `reminderTag`, `callbackHookId`, `residueObligationId` | `CallbackCoverageValidator`, `CallbackOpportunitiesValidator`, `ResidueObligationValidator`, `FlagContractValidator`, and final contract checks inspect usage. |
| Media refs | `MediaRef`, beat image/audio/video, scene background, episode/story cover | Story package and asset checks are artifact/package validation; missing image completeness can block or warn depending the assembly/asset HTTP settings. |

## Source, Treatment, and Adaptation Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Source identity | `SourceMaterialAnalysis.sourceTitle`, `sourceAuthor`, `sourceFormat`, `treatmentMetadata` | `AuthoredEpisodeConformanceValidator` blocks treatment re-cut/default-on gate when treatment-sourced. |
| Adaptation abstraction | `StorySchemaAbstraction.archetype`, `adaptationMode`, `schemaVariables`, `generalizationGuidance`, `reusablePatternSummary` | Planning guidance; no primary blocking gate. |
| Writing style | `WritingStyleGuide.source`, `summary`, `narrativeVoice`, `sentenceRhythm`, `diction`, `dialogueStyle`, `povAndDistance`, `imageryAndSensoryFocus`, `pacing`, `doList`, `avoidList`, `evidence` | `MechanicsLeakageValidator`, `PlanningRegisterLeakValidator`, `SentenceOpenerVarietyValidator`, `PovClarityValidator`, prose-style gates, and QA checks catch drift/leaks. Mostly default-on for high-confidence leaks; sentence opener is default-off. |
| Direct source language | `DirectLanguageFragment`, `DirectLanguageFragmentGroups` | `quoteRecallValidator` is artifact/helper; treatment/source fidelity checks may use quote anchors. |
| Fashion/visual identity | `CharacterFashionStyle`, NPC/protagonist `fashionStyle`, story `artStyleProfile`, `styleAnchors` | Mostly image/style pipeline; character treatment realization can block when authored visual identity is concrete. |
| Treatment season guidance | `TreatmentSeasonGuidance` fields: promise, genre/tone, pitch/logline, core/audience/premise promise, theme, central pressure, protagonist/world guidance, stakes, info ledger, Story Circle anchors, arc plan, scene planning, branch/consequence chains, fail-forward, endings, failure-mode audit | Treatment-fidelity and realization validators cover these. Many are blocking default-on when concrete and treatment-sourced: season promise, treatment field utilization, Story Circle anchor, authored episode conformance, information schedule, character treatment, failure-mode audit. |
| Treatment episode guidance | `TreatmentEpisodeGuidance` fields: title, structural notes, dramatic question, episode promise, cold open, opening image/situation, turns, synopsis, encounter anchors/conflict/buildup/aftermath, stakes layers, theme/lie/pressure lanes, scene targets, entry/obstacle/forced choice/exit/power/subtext, information movement, choice pressures, alternate paths, consequence seeds/residue, visual anchor, ending/cliffhanger fields, emotional charge, capability growth | Realized through `AuthoredTreatmentFieldContract`, `RequiredBeat`, `SceneTurnContract`, `TreatmentFieldUtilizationValidator`, `RequiredBeatRealizationValidator`, `TreatmentSeedOnPageValidator`, and `SceneTurnRealizationValidator`. |

## Structural Story Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Story anchors | `StoryAnchors.stakes`, `goal`, `incitingIncident`, `climax`; copied to `SeasonPlan.anchors` | Story Circle/season planning context; fidelity validators and plan prompts preserve them. |
| Story Circle spine | `StoryCircleStructure.you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`; `SeasonPlan.storyCircle`; `SourceMaterialAnalysis.storyCircle` | `StoryCircleCoverageValidator` is blocking at season planning; `StoryCircleAnchorConformanceValidator` is blocking/default-on for authored anchors; `EpisodeStoryCircleValidator` is blocking at episode architecture. |
| Story Circle role assignment | `StoryCircleRoleAssignment.beat`, `roleKind`, `expansionOfUnit`, `source`; `SeasonEpisode.storyCircleRole`; `EpisodeOutline.storyCircleRole` | `StoryCircleCoverageValidator`, `StoryCircleAnchorConformanceValidator`, and `EpisodeStoryCircleValidator`. |
| Episode-local Story Circle | `Episode.episodeCircle` and blueprint `episodeCircle` | `EpisodeStoryCircleValidator` blocks missing/incomplete blueprint circles; final prose realization is advisory unless `GATE_EPISODE_STORY_CIRCLE_REALIZATION` is enabled, which is currently default-off. |
| Story Circle beat realization | `StoryCircleBeatRealizationContract.beat`, `sourceText`, `targetEpisodeNumber`, `requiredRealization`, `eventAtoms`, `stateChange`, `targetSceneIds`, `blockingLevel` | `StoryCircleAnchorConformanceValidator` blocks placement; `SceneTurnRealizationValidator` and `TreatmentFieldUtilizationValidator` can block concrete realization when gates are on. |
| Encounter Story Circle target | `EncounterStoryCircleTarget` = `go/search/find/take`; `PlannedEncounter.storyCircleTarget`, `PlannedSceneEncounter.storyCircleTarget`; evidence/rationale fields | Season planner normalizes this; encounter validators and treatment utilization inspect whether encounter pressure is staged. |
| Legacy structural map | `LegacyStructuralMap.hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, `resolution`; `StructuralRole` also has `rising`/`falling` | Compatibility. Used for old artifacts and migration into Story Circle. No current `SevenPointCoverageValidator` file exists in the active validator tree. |
| Narrative function compatibility | `EpisodeOutline.narrativeFunction.setup/conflict/resolution` | Compatibility field retained for older analyzer output; not an active structure gate. |

## Season, Arc, Promise, and Information Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Season plan | `SeasonPlan` metadata, synopsis, total episodes, arcs, anchors, story circle, episodes, progress, protagonist, introductions, scene plan, encounter plan, branches, consequence chains, flags, preferences, warnings/notes | Season-level planning validators; `StoryCircleCoverageValidator` is hard blocking. |
| Season arc | `SeasonArc.id`, `name`, `description`, `episodeRange`, `keyMoments`, `storyCircleSpan`, `arcQuestion`, `seasonQuestionRelation`, `identityPressureFacet`, `midpointRecontextualization`, `lateArcCrisis`, `finaleAnswer`, `handoffPressure`, `episodeTurnouts`, status/progress | `ArcPressureArchitectureValidator` advisory in registry but `GATE_ARC_PRESSURE` is default-on plan blocking; `ArcDeltaValidator` default-on remediation/autofix for character delta alignment. |
| Arc episode turnout | `ArcEpisodeTurnout.episodeNumber`, `storyCircleBeat`, `storyCircleRoleKind`, `turnType`, `description`, `leavesProtagonistWith`, `whyThisCannotMoveLater` | `ArcPressureArchitectureValidator`; `ArcPressureTreatmentContract` realization. |
| Season promise architecture | `SeasonPromiseArchitecture.seasonDramaticQuestion`, central pressure type/description/pressuresLieBy, premise/player/emotional promise, variation plan, resolved question/stakes/state change/open future pressure | `SeasonPromiseValidator` advisory at season stage; `SeasonPromiseRealizationValidator` blocking/default-on for concrete promise realization. |
| Theme argument | `ThemeArgumentContract.themeQuestion`, controlling/counter idea, value ladder, archetypal core, unique surface, climax event, retroactive reframe, emotion target, image system | `ThemeArgumentContractValidator` is artifact/helper; `ThemePressureValidator` advisory architecture check; broader theme failure-mode checks advisory unless contract-backed. |
| Information ledger | `InformationLedgerEntry` fields: label/description, audience knowledge state, tension mode, knownBy/withheldFrom, introduced/reveal/payoff episodes, setup touches, payoff plan, box-question links, factual atoms, named knowledge, knowledge phases | `InformationLedgerValidator` advisory in registry; `InformationLedgerScheduleValidator` blocking/default-on gate for authored schedule and impossible/missing setup/reveal/payoff. |
| Audience knowledge | `AudienceKnowledgeState` = `shared/withheld/selective`; `InformationKnowledgeHolder`; `InformationKnowledgePhase.allowedSurface`; `InformationTensionMode` = suspense/mystery/dramatic irony/surprise/revelation/foreshadowing | Validated by information ledger validators and canon consistency. |
| Cliffhanger | `CliffhangerPlan.type`, `intensity`, `hook`, `setup`, `resolvedEpisodeTension`, `newOpenQuestion`, `emotionalCharge`, `nextEpisodePressure`, `mappedStructuralRole`, `storyCircleLaunchBeat`, `style`; episode guidance cliffhanger fields | `CliffhangerValidator` advisory/soft default-on repair; not a hard abort by itself. |
| Ending model | `EndingMode`, `StoryEndingTarget`, `EndingStateDriver`, target conditions, repeated choice pattern, final line; `EndingRealizationContract` | `EndingReachabilityValidator` is blocking-capable/default-off; ending realization contracts are concrete authored obligations. |
| Failure-mode audit | `FailureModeAuditCode`, `FailureModeAuditContractKind`, mitigation/watch-item status, realization targets | `NarrativeFailureModeValidator` is advisory for broad craft; failure-mode audit contracts are blocking/default-on via `GATE_FAILURE_MODE_AUDIT_REALIZATION`. |
| Season bible / older act planning | `SeasonBible`, `EpisodePlan`, `StorySpinePosition`, `seasonAct`, tentpole/midseason/finale fields, subplot/revelation/promise ledgers | Compatibility/older planning surface. Current active structure uses `SeasonPlan` plus Story Circle; do not treat `seasonAct` as the authoritative structure gate. |

## Scene Planning and Dramatic Realization Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Scene-first season plan | `SeasonScenePlan.scenes`, `byEpisode`, `setupPayoffEdges`, assigned contract arrays | `SceneSpineValidator` artifact/helper; `SceneGraphBranchValidator`; setup/payoff and treatment realization validators. |
| Planned scene | `PlannedScene.id`, `episodeNumber`, `order`, `kind`, `planningOrigin`, `title`, `dramaticPurpose`, `narrativeRole`, locations, NPCs, time metadata, `setsUp`, `paysOff`, stakes, encounter, required beats, signature moment, turn/relationship/mechanic/treatment contracts, hasChoice, choiceType, consequenceTier, budgetWeight, charge diagnostics | Many validators touch this: `SceneTurnContractValidator`, `RequiredBeatRealizationValidator`, `SignatureDevicePresenceValidator`, `SceneTransitionContinuityValidator`, `SceneGraphBranchValidator`, `TreatmentFieldUtilizationValidator`, `NarrativeMechanicPressureValidator`. |
| Scene kind | `SceneKind` = `standard/encounter` | Encounter scenes route through EncounterArchitect and encounter validators; standard scenes through SceneWriter. |
| Scene narrative role | `SceneNarrativeRole` = setup/development/turn/payoff/release | `DramaticStructureValidator`, `SceneTurnContractValidator`, `SceneTurnRealizationValidator`; architecture gate defaults on for scene shape. |
| Required beats | `RequiredBeat.id`, `sourceTurn`, `mustDepict`, `tier` = signature/authored/seed/coldopen/connective | `RequiredBeatRealizationValidator` blocking/default-on for authored required beats; treatment seed realization default-on; cold open realization default-off. Signature beats also use `SignatureDevicePresenceValidator`. |
| Signature moment/device | `PlannedScene.signatureMoment`, `RequiredBeat.tier='signature'` | `SignatureDevicePresenceValidator` blocking/default-on; strict signature presence default-on; judge confirmation/regen route. |
| Scene turn | `SceneTurnContract.centralTurn`, `beforeState`, `turnEvent`, `afterState`, `handoff`, source | `SceneTurnContractValidator` architecture advisory in registry, but `GATE_SCENE_TURN_CONTRACT` is default-on plan blocking; `SceneTurnRealizationValidator` is blocking/default-on for final prose. |
| Dramatic structure | Blueprint dramatic audit, scene questions, entry intents, obstacles, changed states, major turns | `DramaticStructureValidator` architecture advisory in registry, but `GATE_DRAMATIC_STRUCTURE` is default-on plan blocking. |
| Theme pressure | Treatment/scene theme pressure fields, `ThemePressureValidator` inputs | Advisory architecture check. |
| Episode pressure | Episode pressure architecture in blueprints | Advisory architecture check unless converted into concrete arc/promise/treatment contracts. |
| Timeline/transition | `PlannedScene.timeOfDay`, `timeJump`; `Scene.timeline.location`, `timeOfDay`, `timeJumpFromPrevious`, `transitionIn` | `SceneTransitionContinuityValidator` blocking/default-on. |
| Character introduction | NPC roster, scene `charactersInvolved`, prose first appearance, character introduction plan | `CharacterIntroductionValidator` registry advisory but `GATE_CHARACTER_INTRODUCTION` is default-on blocking with regen route. |
| Duplicate establishing beat | Scene/location first-entry semantics | `DuplicateEstablishingBeatValidator` advisory class with default-on blocking gate/autofix. |
| Referenced event presence | Prose references to enumerated/planned prior events/items | `ReferencedEventPresenceValidator` default-on blocking via final contract, judge+regen. |
| Planning-register prose leak | Planning/task language leaked into reader prose | `PlanningRegisterLeakValidator` helper plus `GATE_PLANNING_REGISTER_PROSE` default-on blocking scene gate. |
| POV/prose clarity | Protagonist pronouns, encounter POV, NPC pronouns, prose integrity, style consistency, sentence opener variety | Encounter POV and prose style consistency are default-on gates; protagonist/NPC pronoun and sentence opener gates are default-off where precision/repair is not fully proven. |

## Character, NPC, Relationship, and Identity Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Protagonist architecture | `ProtagonistCharacterArchitecture.lie`, `originPressure`, `truth`, `want`, `need`, `arcMode`, `climaxChoice` | `CharacterArchitectureValidator` advisory season check; `CharacterTreatmentRealizationValidator` blocking/default-on for authored concrete fields. |
| Supporting micro-arcs | `SupportingCharacterMicroArc.microLie`, `truthOrCounterPressure`, `screenTimeTier`, `pressureRole`, visible signals, planned resolution | `CharacterArchitectureValidator`; `NPCDepthValidator` advisory/default-on autofix for richer NPC depth. |
| Character arcs | `CharacterArc`, `CharacterArcMode`, `CharacterArcTracker` artifacts | `ArcDeltaValidator` default-on remediation/autofix; `CharacterArcTracker` artifact-only owner in registry. |
| NPC roster | `Story.npcs`: id/name/description/role/portrait/pronouns/relationship dimensions/tier/want/fear/flaw/voice/secrets/arc | `NPCDepthValidator`, `MechanicalStorytellingValidator`, relationship ID/witness gates, character introduction. |
| Relationship state | Runtime `Relationship.trust/affection/respect/fear`; relationship consequences and conditions | `MechanicalStorytellingValidator` catches unknown NPC targets; `GATE_RELATIONSHIP_ID_INTEGRITY` default-on blocks unresolved relationship targets. |
| Relationship pacing | `RelationshipPacingContract.startStage`, `targetStage`, allowed/blocked labels, evidence, min scenes, max delta, dimensions | `RelationshipPacingValidator` blocking/default-on. |
| Relationship value ladder | `RelationshipValueState.axis`, `rung`, meaning, confidence, evidence tags, allowed surfaces; `RelationshipEvidenceConsequence`; `RelationshipRungCondition` | `RelationshipValueLadderValidator` artifact/helper; relationship pacing/mechanical validators check realized use. |
| Identity profile | `IdentityProfile` axes: mercy_justice, idealism_pragmatism, cautious_bold, loner_leader, heart_head, honest_deceptive | Runtime conditions/consequences; `ArcDeltaValidator`, `MechanicalStorytellingValidator`, and choice residue checks inspect identity movement. |
| Character treatment fields | `CharacterTreatmentFieldKind`: canonical identity, role fact, origin pressure, want/need/lie/wound/truth, arc mode, starting identity, ending state, climax choice, pressure point, visual identity | `CharacterTreatmentRealizationValidator` blocking/default-on. |

## Gameplay State and Mechanics Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Hidden attributes | `PlayerAttributes`: charm, wit, courage, empathy, resolve, resourcefulness | Runtime resolution; `StatCheckBalanceValidator`, `SkillCoverageValidator`, `SkillSurfaceValidator`, `CompetenceReachabilityValidator` helper. |
| Skills | `PlayerSkills`; `SkillDefinition`; choice `statCheck.skillWeights`; encounter `primarySkill` and relevant skills | `StatCheckBalanceValidator` default-on autofix; `SkillCoverageValidator` advisory; `SkillSurfaceValidator` advisory/full QA; skill plan conformance default-off. |
| Conditions | Attribute/skill/relationship/flag/score/tag/item/identity/relationshipRung plus `and/or/not` | Runtime `conditionEvaluator`; final contract and flag/route validators catch unreachable/missing setters; flag contract is blocking-capable/default-off. |
| Consequences | Attribute/skill/relationship/relationshipEvidence/flag/score/tag/item changes; delayed consequences | Runtime `storyEngine` and consequence normalization; `MechanicalStorytellingValidator`, `NarrativeMechanicPressureValidator`, `ConsequenceBudgetValidator`, `FlagContractValidator`, residue/callback validators. |
| Delayed consequences | `DelayedConsequence`, `Choice.delayedConsequences`, encounter delayed consequences | Runtime queue; convergence/residue/callback checks inspect later payoff. |
| Mechanic pressure | `MechanicPressureContract.domain` = relationship/identity/skill/flag/score/item/route/encounter/information/resource/reputation; `function` = plant/intensify/gate/spend/payoff/complicate/resolve; refs/evidence/residue/payoffs/blocked payoffs | `NarrativeMechanicPressureValidator` blocking/default-on; mechanic pressure repair default-on. |
| Fiction-first mechanics | Choice feedback cues, reminder plans, story verbs, visible residue, outcome text, reader-prose sanitizer | `MechanicsLeakageValidator` default-on autofix/remediation; design-note leaks default-on blocking/autofix; `PlanningRegisterLeakValidator` default-on gate; `SkillSurfaceValidator`. |
| Stat checks | `Choice.statCheck.skillWeights`, difficulty, modifiers, legacy attribute/skill, retryable flag; `ResolutionTier` success/complicated/failure | `StatCheckBalanceValidator` default-on autofix; `CompetenceReachabilityValidator` helper checks dead walls; `resolutionEngine` applies hidden resolution. |
| Inventory/items | Player inventory; item conditions/consequences; mechanic pressure refs | Runtime state; prop/item introduction and referenced-event validators. |
| Scores/flags/tags | `PlayerFlags`, `PlayerScores`, `PlayerTags`, flag/score/tag consequences and conditions | `FlagContractValidator` default-off blocker; `ResidueObligationValidator` default-off remediation; final contract blocks invalid runtime references. |
| Visit/episode completion | `VisitRecord`, `EpisodeCompletion` | Runtime/reader recap state; not a generation gate. |

## Choice and Branching Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Choice | `Choice.id`, `text`, `conditions`, `showWhenLocked`, `lockedText`, `statCheck`, consequences, delayed consequences, `nextSceneId`, `nextBeatId`, outcome texts, reaction text, tint flag, memorable moment | `ChoiceImpactValidator` default-on remediation/autofix; `ChoiceCoverageValidator` advisory; `FinalStoryContractValidator` validates targets and outcome text. |
| Choice type | `ChoiceType` = expression/relationship/strategic/dilemma; planned `PlannedScene.choiceType`; budget target 35/30/20/15 | `ChoiceDistributionValidator` advisory by default; `GATE_CHOICE_DISTRIBUTION` default-off. Choice type conformance default-off. |
| Choice intent | `ChoiceIntent` = flavor/branching/blind/dilemma | `ChoiceImpactValidator` uses this for expression/flavor branch prohibition and stakes needs. |
| Choice impact factors | `ChoiceImpactFactor` = outcome/process/information/relationship/identity | `ChoiceImpactValidator` warning plus default-on autofix/backfill; `FiveFactorValidator` advisory. |
| Choice consequence tier | Runtime `ChoiceConsequenceTier` = callback/sceneTint/branchlet/structuralBranch; planned `ConsequenceTier` = callback/tint/branchlet/branch | `ConsequenceBudgetValidator` plan gate default-on; consequence tier conformance default-off; `ChargeMaterializationValidator` helper checks hollow heavy branches. |
| Stakes layers | `StakesLayers.material`, `relational`, `identity`, `existential`; `Choice.stakes.want/cost/identity` | `ChoiceImpactValidator` warns when meaningful branching/dilemma choices lack stakes; `StakesTriangleValidator` advisory/soft repair. |
| Moral contract | `MoralContract.valueA`, `valueB`, unavoidable cost, benefits, harms, uncertainty | Choice authoring field; five-factor/stakes checks inspect meaningful choice shape. |
| Reminder plan and feedback cue | `ReminderPlan.immediate/shortTerm/later`; `ChoiceFeedbackCue` risk/leverage/echo/progress/check class | Callback/opportunity/residue validators and fiction-first mechanical storytelling checks. |
| Residue hints | `ChoiceResidueHint.kind`, description, target episode/NPC/callback; `FailureResidue`; `WitnessReaction` | `BranchMechanicalDivergenceValidator`, `CallbackOpportunitiesValidator`, `ResidueObligationValidator`, witness bake/default-on remediation, witness ID gate/default-on. |
| Affordance source | `ChoiceAffordanceSource` = identity/relationship/tag/item/skill/flag/callback | Choice/gating surface; `SkillSurfaceValidator`, `MechanicalStorytellingValidator`, and condition validators. |
| Choice density | First-choice timing and average gap targets; generated timing assumptions | `ChoiceDensityValidator` advisory in registry with `GATE_CHOICE_DENSITY` default-on plan blocking. |
| Choice type plan conformance | Generated choice types compared to per-scene/episode plan assignments | `ChoiceTypePlanConformanceValidator` exists; enforcement is blocking-capable/default-off via `GATE_CHOICE_TYPE_CONFORMANCE`. |
| Choice coverage | Planned scene choice points vs generated choices | `ChoiceCoverageValidator` advisory. |
| Expression choices do not branch | `Choice.choiceType='expression'` or intent flavor with `nextSceneId` | `ChoiceImpactValidator` emits error; `ChoiceDistributionValidator` treats expression branching as semantic violation. |
| Branch routing | `Choice.nextSceneId`, `Beat.nextSceneId`, `Scene.leadsTo`, `fallbackSceneId`, branch scene ids | `SceneGraphBranchValidator`, `DivergenceValidator`, `storyPathAnalyzer`, final contract. Branch fan-out default-on blocker. |
| Branch type/tone | `Scene.branchType` = dark/hopeful/neutral/tragic/redemption | Runtime branch history/reader experience; branch validators focus on topology/residue, not tone labels as hard gates. |
| Bottlenecks/convergence | `Scene.isBottleneck`, `isConvergencePoint`; planned setup/payoff and reconvergence | `SceneGraphBranchValidator`; reconvergence residue repair default-on. |
| Cross-episode branches | `CrossEpisodeBranch.trigger`, paths, affected episodes, reconvergence; `SeasonPlan.crossEpisodeBranches`; `EpisodeOutline.incomingBranches/outgoingBranches` | Branch/consequence contracts and `BranchMechanicalDivergenceValidator`; ending reachability default-off. |
| Branch consequence contracts | `BranchConsequenceRealizationContract` kinds: origin choice, path state, later payoff, reconvergence residue, state change, ending eligibility | Treatment/branch realization checks; branch plan artifact contract is blocking in artifact registry; runtime enforcement is via final contract/gates when concrete. |
| Consequence chains | `ConsequenceChain.origin`, downstream consequences and severity | `ConsequenceBudgetValidator`, residue/callback validators, branch consequence contracts. |
| Ending route eligibility | `StoryEndingTarget.targetConditions`, `EndingRealizationContract`, treatment branch axes | `EndingReachabilityValidator` default-off blocker; final ending realization surfaces. |
| Path simulation/coverage | `pathSimulator`, `storyPathAnalyzer`, Playwright QA choice paths | Artifact/helper and E2E QA; browser QA errors are non-fatal warnings unless broader QA block gate is enabled. |

## Encounter Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Encounter type/style | `EncounterType` and `EncounterNarrativeStyle`; planned encounter category/style | `EncounterQualityValidator` blocking final validator; `EncounterAnchorContentValidator` blocks authored encounter anchors/default-on. |
| Encounter clocks | `goalClock`, `threatClock`, `EncounterClock.type` goal/threat/complication, segments/filled | Encounter runtime and quality checks; visible clocks are fiction-first/approximate. |
| Encounter outcomes | `EncounterOutcome` victory/partialVictory/defeat/escape; outcomes and storylets; outcome flags/variants | `EncounterQualityValidator`, `OutcomeTextQualityValidator`, encounter outcome variant gate default-on. |
| Encounter costs | `EncounterCost.domain`, severity, bearer, immediate/visible/lingering effect, consequences | Encounter quality, mechanical story pressure, consequence budget. |
| Encounter choice tree | `EncounterChoice`, `EmbeddedEncounterChoice`, outcome tiers success/complicated/failure, next situation, terminal flags | `EncounterQualityValidator`, `OutcomeTextQualityValidator`, `PixarPrinciplesValidator`, `BranchMechanicalDivergenceValidator`. |
| Encounter phases/beats | `EncounterPhase`, `EncounterBeat.phase`, setup/rising/peak/resolution | `EncounterSetPieceDepthValidator` blocking/default-on; encounter prose integrity default-off. |
| Environmental elements | Hazard/opportunity/neutral, activation condition, effect, active/used, visual description | Encounter authoring/runtime; encounter quality checks. |
| NPC encounter state | Disposition, reactions by approach, tells, disposition shifts | Encounter quality and mechanical storytelling checks. |
| Escalation triggers | Threat/beat/time/failure conditions, complications, escape, point of no return | Encounter quality and set-piece depth checks. |
| Information visibility/fog of war | Threat visibility/approximation, tell reveal timing, hidden environment, unknown outcomes | Encounter quality and fiction-first surface. |
| Pixar stakes/surprise | `PixarStakes` odds/losses/obstacles/physical/emotional/philosophical; `PixarSurprise.setup/twist/satisfaction` | `PixarPrinciplesValidator` advisory in registry; findings can affect quality score. |
| Encounter storyboard/visual state | Storyboard frames, visual contracts, continuity state, visual directions, tension curve, camera escalation | Image/visual validators and encounter set-piece depth; mostly advisory/artifact unless tied to blocking encounter/story gates. |

## Setup, Payoff, Callback, Residue, and Consequence Intelligence

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Narrative thread | `NarrativeThread.kind` seed/clue/promise/reveal, priority, status, plants, payoffs, expected payoff episode | `SetupPayoffValidator` advisory but `GATE_SETUP_PAYOFF` default-on plan blocking; `TwistQualityValidator` advisory for foreshadow/reveal order. |
| Thread ledger | `ThreadLedger.threads`, design notes | Thread/callback artifact contract; setup/payoff and callback validators. |
| Callback hooks | Beat `callbackHookIds`, text variant `callbackHookId`, choice memorable moments | `CallbackCoverageValidator` advisory but `GATE_CALLBACK_COVERAGE` default-on plan blocking; `CallbackOpportunitiesValidator` advisory opportunity density. |
| Promise ledger | Callback/promise target episodes and condition keys | `PromiseLedgerValidators` blocking at episode seal/final contract. |
| Residue obligations | `SeasonResidueObligation` source, episode/scene/choice ids, kind, domain, payoff policy, targets, source material, guidance, required surface, priority; choice `residueObligationIds`; text variant `residueObligationId` | `ResidueObligationValidator` advisory/default-off remediation; branch residue repair default-on. |
| Convergence ledger | `ConvergenceLedger.nodes/edges`, source, magnitude, anchorId, gate level, overcomes prior failure, materialized | `ConvergenceLedgerValidator`, `ChargeMaterializationValidator`, `CompetenceReachabilityValidator` are artifact/helper or plan-time support; consequence budget/branch tiering use the concept. |
| Consequence charge | Planned scene `chargeScore`, `tierRationale`; edge magnitude | Diagnostics/default-off consequence intelligence support; not reader-facing. |
| Hollow branch / materialization | Heavy branchlet/branch tier without materialized charge | `ChargeMaterializationValidator` helper emits errors for hollow heavy branches, advisory for lighter under-materialization. |
| Competence reachability | Skill/attribute-gated heavy choices/encounters must be achievable or fail-forward | `CompetenceReachabilityValidator` artifact/helper; advisory unless caller gates it. |
| Season budget | Planned weighted choice/consequence budget, scene vs encounter budget weights, tolerance bands | `SeasonBudgetValidator` exists as an artifact/helper validator; `ConsequenceBudgetValidator` and choice plan gates are the active registry-facing budget checks. |

## Validation Reporting Concepts

| Concept | Field surface | Validation/enforcement |
|---|---|---|
| Choice agency canonical report | `ChoiceAgencyContract`, `ChoiceAgencyFinding`, `ChoiceAgencyCanonicalReport`, repair routes such as choice repair, branch-residue repair, skill-surface repair | Shadow/canonical grouping so overlapping choice-agency findings do not double-count; does not by itself alter pass/fail. |
| Treatment obligation canonical report | `TreatmentObligationContract`, `TreatmentObligationFinding`, `TreatmentObligationCanonicalReport`, repair routes such as plan repair, scene regen, encounter regen, judge-and-regen | Shadow/canonical grouping for treatment fidelity and realization findings; final severity still comes from gates/final contract policy. |
| Validator execution records | `ValidatorExecutionRecord`, lifecycle, role, gate flag, placement, issues, repair attempt/success/residual blocking count | Telemetry/reporting surface for validator ownership and gate behavior. |

## Validator and Gate Summary

### Always or Directly Blocking in the Registry

| Validator/check | Concept | Notes |
|---|---|---|
| `StoryCircleCoverageValidator` | Season Story Circle coverage/order/contiguity | Blocking season gate. |
| `EpisodeStoryCircleValidator` | Episode blueprint carries all eight episode Story Circle beats and scene bindings | Blocking architecture gate. |
| `FinalStoryContractValidator` | Runtime story contract, valid routing, no unresolved templates/leaks, final package correctness | Blocking final gate. |
| `EncounterQualityValidator` | Encounter structural/runtime quality | Blocking final gate. |
| `PromiseLedgerValidators` | Explicit payoff-episode promise contract | Blocking episode/final seal. |
| `CanonConsistencyValidator` | Knowledge-state and canon consistency | Blocking episode/final seal. |

### Default-On Blocking or Repair Gates

| Gate | Primary concept | Placement | Enforcement |
|---|---|---|---|
| `GATE_ARC_PRESSURE` | Arc pressure architecture | Plan | Blocking plan gate. |
| `GATE_CHOICE_DENSITY` | Choice density | Plan | Blocking plan gate. |
| `GATE_CONSEQUENCE_BUDGET` | Consequence budget | Plan | Blocking plan gate. |
| `GATE_SETUP_PAYOFF` | Setup/payoff graph | Plan | Blocking plan gate. |
| `GATE_CALLBACK_COVERAGE` | Callback ledger coverage | Plan | Blocking plan gate. |
| `GATE_WITNESS_ID_INTEGRITY`, `GATE_RELATIONSHIP_ID_INTEGRITY`, `GATE_WITNESS_SCENE_PRESENCE` | Witness/relationship NPC reference integrity and presence | Episode | Blocking or autofix-backed integrity gates. |
| `GATE_BRANCH_FANOUT` | Dead/collapsed branch fan-out | Plan | Blocking plan gate. |
| `GATE_TREATMENT_SEED_ONPAGE` | Treatment seed flags are set on page | Plan | Blocking plan gate. |
| `GATE_DRAMATIC_STRUCTURE` | Scene dramatic structure | Plan | Blocking with regen route. |
| `GATE_SCENE_TURN_CONTRACT` | Scene turn contract shape | Plan | Blocking with regen route. |
| `GATE_AUTHORED_EPISODE_CONFORMANCE` | Treatment episode identity/order | Plan | Blocking treatment-fidelity gate. |
| `GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE` | Authored Story Circle anchors land in assigned episodes | Plan | Blocking treatment-fidelity gate. |
| `GATE_INFORMATION_LEDGER_SCHEDULE` | Authored information setup/reveal/payoff schedule | Plan/final net | Blocking treatment-fidelity gate. |
| `GATE_TREATMENT_FIELD_UTILIZATION` | Parsed treatment fields consumed and realized | Plan/final net | Blocking with regen route. |
| `GATE_SEASON_PROMISE_REALIZATION` | Season promise visible on page | Plan/final net | Blocking with regen route. |
| `GATE_CHARACTER_TREATMENT_REALIZATION` | Authored character fields realized | Plan/final net | Blocking with regen route. |
| `GATE_FAILURE_MODE_AUDIT_REALIZATION` | Failure-mode audit mitigations realized | Plan/final net | Blocking with regen route. |
| `GATE_ENCOUNTER_ANCHOR_CONTENT` | Authored encounter anchor/conflict content | Scene/final net | Blocking with judge+regen. |
| `GATE_SIGNATURE_DEVICE_PRESENCE` / `GATE_SIGNATURE_PRESENCE_STRICT` | Signature device/image appears | Scene/final net | Blocking with judge+regen. |
| `GATE_REQUIRED_BEAT_REALIZATION` | Authored required beats appear | Scene/final net | Blocking with judge+regen. |
| `GATE_REFERENCED_EVENT_PRESENCE` | Enumerated/planned referenced events are present | Season-final | Blocking with judge+regen. |
| `GATE_TREATMENT_SEED_REALIZATION` | Treatment seed/cold-open-like plants appear | Episode/final net | Blocking with regen; cold-open strict gate remains default-off. |
| `GATE_SCENE_TRANSITION_CONTINUITY` | Time/place transition continuity | Episode/final net | Blocking with regen. |
| `GATE_SCENE_TURN_REALIZATION` | Scene turn appears in prose | Scene/final net | Blocking with regen. |
| `GATE_RELATIONSHIP_PACING` | Earned relationship labels/stages | Season-final | Blocking with regen. |
| `GATE_NARRATIVE_MECHANIC_PRESSURE` | Hidden mechanics have on-page evidence/residue/payoff | Season-final | Blocking with regen. |
| `GATE_ENCOUNTER_SETPIECE_DEPTH` | Sustained encounter structure/depth | Scene/final net | Blocking/autofix route. |
| `GATE_CHARACTER_INTRODUCTION` | Characters introduced before familiarity/use | Season-final | Blocking with regen. |
| `GATE_ENCOUNTER_OUTCOME_VARIANT` | Reconvergence acknowledges encounter outcome | Season-final | Blocking with regen. |
| `GATE_OUTCOME_TEXT_QUALITY` | Outcome text is not stub/duplicate/scaffold | Scene/final net | Blocking/autofix. |
| `GATE_DUPLICATE_ESTABLISHING_BEAT` | Duplicate location/establishing first-entry defects | Season-final | Blocking/autofix. |
| `GATE_DESIGN_NOTE_LEAK`, `GATE_PLANNING_REGISTER_PROSE`, `GATE_PROSE_STYLE_CONSISTENCY`, `GATE_ENCOUNTER_POV` | Prose/POV/authoring-leak correctness | Scene/final net | Default-on blocking or autofix routes. |
| `GATE_NPC_DEPTH`, `GATE_CHOICE_IMPACT`, `GATE_STAT_CHECK_BALANCE`, `GATE_ARC_DELTA`, `GATE_MECHANICS_LEAKAGE`, `GATE_WITNESS_BAKE` | Deterministic quality repairs | Episode/quick | Default-on remediation/autofix rather than direct abort. |
| `GATE_JUDGE_STABILIZATION`, `GATE_CLIFFHANGER` | Bounded soft-gate stabilization and cliffhanger repair | Episode | Soft/default-on; does not directly abort. |

### Default-On Repair Infrastructure Gates

These are not storytelling concepts by themselves, but they decide how blocking findings are confirmed or repaired: `GATE_FINAL_CONTRACT_REPAIR`, `GATE_FINAL_CONTRACT_SCENE_REGEN`, `GATE_FINAL_CONTRACT_OUTCOME_REGEN`, `GATE_SCENE_REQUIRED_BEAT_CHECK`, `GATE_FIDELITY_JUDGE_CONFIRM`, `GATE_SEASON_PROMISE_REPAIR`, `GATE_CHARACTER_TREATMENT_REPAIR`, `GATE_FAILURE_MODE_AUDIT_REPAIR`, `GATE_MECHANIC_PRESSURE_REPAIR`, `GATE_SCENE_TURN_CLUSTER_REPAIR`, `GATE_TREATMENT_SOURCED_ARM`, and `GATE_RECONVERGENCE_RESIDUE_REPAIR`.

### Blocking-Capable but Default-Off Gates

| Gate | Concept |
|---|---|
| `GATE_CHOICE_DISTRIBUTION` | Choice type mix and branch cap strictness. |
| `GATE_PROP_INTRODUCTION` | Structured cast/prop reference introduction. |
| `GATE_PROTAGONIST_PRONOUN` | Ambiguous protagonist pronoun residue. |
| `GATE_NPC_PRONOUN` | NPC pronoun coreference residue. |
| `GATE_ENCOUNTER_PROSE_INTEGRITY` | Malformed encounter prose residue. |
| `GATE_ENCOUNTER_SKILL_REBALANCE` | Encounter dominant-skill rebalance. |
| `GATE_COLD_OPEN_REALIZATION` | Strict cold open realization. |
| `GATE_SENTENCE_OPENER_VARIETY` | Repetitive sentence opener cadence. |
| `GATE_EPISODE_STORY_CIRCLE_REALIZATION` | Final prose realization of episode-local Story Circle beats. |
| `GATE_CHOICE_TYPE_CONFORMANCE` | Per-episode generated choice types match plan. |
| `GATE_CONSEQUENCE_TIER_CONFORMANCE` | Per-episode generated consequence tiers match plan. |
| `GATE_SKILL_PLAN_CONFORMANCE` | Per-episode generated skills match plan. |
| `GATE_FLAG_CONTRACT` | Flag setters/readers are coherent. |
| `GATE_RESIDUE_CONSUME` | Set flags/residue are consumed downstream. |
| `GATE_CONTINUITY_REMEDIATION` | Promote specific continuity errors into repair/block path. |
| `GATE_QA_CRITICAL_BLOCK` | Promote full QA critical issues to blocking. |
| `GATE_ENDING_REACHABILITY` | Declared ending axes are mechanically reachable. |

### Advisory and Quality-Evidence Validators

These validators exist in the registry as advisory unless their findings are routed through one of the default-on/default-off gates above: `CharacterArchitectureValidator`, `SeasonPromiseValidator`, `InformationLedgerValidator`, `TreatmentFidelityValidator`, `ThemePressureValidator`, `EpisodePressureArchitectureValidator`, `PhaseValidator`, `MechanicalStorytellingValidator`, `StakesTriangleValidator`, `FiveFactorValidator`, `ChoiceDistributionValidator`, `CallbackOpportunitiesValidator`, `SkillCoverageValidator`, `SkillSurfaceValidator`, `BranchMechanicalDivergenceValidator`, `PixarPrinciplesValidator`, `CliffhangerValidator`, `TwistQualityValidator`, `DivergenceValidator`, `NarrativeFailureModeValidator`, `IntensityDistributionValidator`, `PropIntroductionValidator`, `ChoiceCoverageValidator`, `SceneGraphBranchValidator`, `TreatmentSeedOnPageValidator`, `EndingReachabilityValidator`, and `CharacterIntroductionValidator`.

### Artifact/Helper Validators Not Primary Registry Gates

These classes/functions were found in the validator tree but are not primary validator-registry entries, or are listed as artifact-only ownership. They still represent real concepts and are used by artifact checks, diagnostics, tests, or repair paths: `ChargeMaterializationValidator`, `CompetenceReachabilityValidator`, `ConsequenceTierPlanConformanceValidator`, `ConvergenceLedgerValidator`, `EncounterProseIntegrityValidator`, `IncrementalEncounterValidator`, `IncrementalStakesValidator`, `IncrementalVoiceValidator`, `IntegratedBestPracticesValidator`, `PlanningRegisterLeakValidator`, `PovClarityValidator`, `RelationshipValueLadderValidator`, `RouteContinuityValidator`, `SceneCraftValidator`, `SceneSpineValidator`, `SeasonBudgetValidator`, `SentenceOpenerVarietyValidator`, `SkillPlanConformanceValidator`, `ThemeArgumentContractValidator`, `TreatmentEventLedgerValidator`, `quoteRecallValidator`, `sequenceContinuityAudit`, `sequencePlanSpecificityAudit`, `turnAudit`, `pathSimulator`, `storyPathAnalyzer`, `playwrightQARunner`, and `storyAssetWalker`.

## Second-Pass Completeness Check

After drafting this inventory, do a second pass over these sources before treating it as current:

- `storyrpg-prototype/src/types/sourceAnalysis.ts`, `seasonPlan.ts`, `scenePlan.ts`, `story.ts`, `content.ts`, `choice.ts`, `conditions.ts`, `consequences.ts`, `player.ts`, `encounter.ts`, `narrativeThread.ts`, `convergenceLedger.ts`, `relationshipValue.ts`.
- `storyrpg-prototype/src/ai-agents/validators/validatorRegistry.ts`, `finalContractSeverityPolicy.ts`, `runFidelityValidators.ts`, and all validator filenames under `storyrpg-prototype/src/ai-agents/validators/`.
- `storyrpg-prototype/src/ai-agents/remediation/gateDefaults.ts` and `gateRegistry.ts`.
- `storyrpg-prototype/src/ai-agents/agents/SeasonPlannerAgent.ts`, `StoryArchitect.ts`, `SceneWriter.ts`, `ChoiceAuthor.ts`, `EncounterArchitect.ts`, `ThreadPlanner.ts`, `TwistArchitect.ts`, `CharacterArcTracker.ts`, and `BranchManager.ts`.
- `docs/STORY_QUALITY_CONTRACT.md`, `docs/STORY_BRANCHING.md`, `docs/GDD.md`, `docs/STORY_PIPELINE_PROMPTING.md`, and `docs/PROJECT_STATUS.md`.

Audit notes from the 2026-06-28 pass:

- Active structure is Story Circle. Legacy seven-point fields remain as compatibility/migration surfaces, but no active `SevenPointCoverageValidator` file was present in `src/ai-agents/validators/`.
- The validator registry had 85 validator classes in the folder scan, with the primary runtime/plan dispatch represented by `VALIDATOR_REGISTRY`; helper/artifact validators are called out separately above.
- Existing docs still contain some older seven-point wording. This inventory follows the current type and validator names rather than stale documentation language where they conflict.
- Mechanical cross-checks after drafting verified that every validator class name under `src/ai-agents/validators/` is named in this document, and every `GATE_DEFAULTS` gate is either listed directly or covered in the default-on/default-off/repair-infrastructure sections.
