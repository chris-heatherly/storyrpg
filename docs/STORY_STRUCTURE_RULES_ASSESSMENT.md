# Story Structure Rules Assessment

## Purpose

This assessment evaluates `/Users/chrisheatherly/Downloads/story-structure-rules.md` against StoryRPG's current narrative pipeline.

The goal is to enhance StoryRPG without regressing work that is already in place, and without turning useful storytelling heuristics into rigid prompt law that throttles LLM creativity into stale, formulaic output.

Decision meanings:

- **Add**: useful new rule or diagnostic that is not sufficiently covered today.
- **Modify + add**: useful, but should be softened, made genre-aware, or adapted to StoryRPG's interactive-fiction architecture.
- **Ignore**: do not add as a new rule because it is already covered, too rigid, or mismatched with StoryRPG.

## Current StoryRPG Coverage

StoryRPG already has substantial story-structure safeguards:

- `SeasonPlannerAgent` owns season-level planning, seven-point structure, anchors, difficulty progression, encounter plans, cliffhanger plans, and season continuity.
- `SevenPointCoverageValidator` checks the load-bearing season structure: `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, and `resolution`.
- `StoryArchitect` creates episode blueprints, scene graphs, branch-and-bottleneck shape, scene dramatic questions, `wantVsNeed`, conflict engines, choice stakes, and encounter buildup.
- `ThreadPlanner` creates a setup/payoff ledger for seeds, clues, promises, and reveals.
- `SetupPayoffValidator` catches planted-but-unpaid and paid-off-but-unplanted threads.
- `TwistArchitect` and `TwistQualityValidator` cover episode reversals, revelations, and foreshadow-before-reveal.
- `CharacterArcTracker` and `ArcDeltaValidator` cover planned identity and relationship movement.
- `SceneWriter` and `SceneCraftValidator` already implement much of the scene-craft guidance: scene purpose, key moments, takeaways, pointed final beats, physical business in dialogue scenes, subtext, concise dialogue, concrete action, fight/action danger, and visible conflict cost.
- `ChoiceImpactValidator`, `DivergenceValidator`, `BranchMechanicalDivergenceValidator`, `CallbackCoverageValidator`, `ConsequenceBudgetValidator`, and `CliffhangerValidator` already cover meaningful choices, branch residue, callbacks, consequence budgeting, reconvergence, and next-episode pressure.

The biggest useful gaps are:

- A compact theme-pressure rubric.
- A qualitative protagonist-agency audit without fixed percentages.
- A clearer information-management rubric for audience knowledge, mystery, suspense, dramatic irony, and unanswered questions.
- A diagnostic for over-foreshadowed twists.
- A diagnostic for unearned escalation and passive/coincidental resolutions.

The least useful path would be pasting the whole external ruleset into every prompt. That would increase prompt weight, create conflicts with existing validators, and over-prescribe TV structure.

## Section 1: Core Principles

| Rule | Decision | Assessment |
|---|---:|---|
| **P1. Causality over chronology.** Scenes connect with "but" or "therefore," never "and then." | Add as editorial gate | **No "And Then" Scenes.** A scene cannot earn its place by happening next. Every scene transition must be explainable as **therefore** or **but**, not merely **and then**. The next scene must be made necessary through consequence, reversal, discovery, cost, escalation, or choice residue, not simple chronology. **Pass condition:** the outgoing beat changes what someone can do, knows, wants, risks, believes, controls, or must answer next. **Fail condition:** the next scene could begin the same way if the prior scene were removed. **Owner:** `StoryArchitect` for scene graph planning, `SceneWriter` for final beat handoff, and a lightweight transition diagnostic for generated scene sequences. |
| **P2. Character drives plot.** The protagonist causes at least 60% of plot events. | Add as planning audit | **Protagonist-Driven Plot.** At least 60% of major plot turns should be caused or meaningfully reshaped by protagonist/player action. A turn counts when it results from a choice, failed attempt, preparation, relationship leverage, information use, refusal, sacrifice, mistake, or identity commitment. **Pass condition:** most major turns trace back to protagonist/player pressure. **Fail condition:** the story advances mainly through external arrivals, coincidence, rescue, villain action, or revelations that happen without protagonist/player pressure. **Owner:** `SeasonPlannerAgent` and `StoryArchitect` should audit major turns before finalizing plans; diagnostics may warn below target, but should not block generation on exact semantic math. |
| **P3. Specificity over scale.** Concrete personal stakes outweigh abstract cosmic ones. | Add as required stakes rule | **Personal Stakes Anchor.** Every episode and every major scene must name the concrete personal stake underneath the plot stake. Large-scale stakes are allowed only when grounded in a specific person, relationship, place, promise, identity, reputation, memory, home, future, or irreversible cost the player can feel. **Pass condition:** the player can say exactly what this costs the protagonist personally. **Fail condition:** the stake is only abstract scale, lore importance, world-ending danger, or generic urgency. **Owner:** `SeasonPlannerAgent`, `StoryArchitect`, `EncounterArchitect`, and choice stakes metadata. |
| **P4. Every level nests.** Scene -> Episode -> Arc -> Season -> Series. Each level has its own dramatic question, midpoint, all-is-lost beat, and climax. | Add as nested structure rule | **Dramatic Structure At Every Magnitude.** Each scene, `sceneEpisode`, episode, arc, and season must have its own dramatic structure: a question or pressure, a turn/reversal/recontextualization, a lowest-point or highest-cost pressure beat, and a resolution or changed state. Lower levels must reinforce higher levels: scene turns serve episode turns, episode turns serve arc pressure, and arc pressure serves the season spine. **Pass condition:** each unit has a felt beginning, turn, pressure peak, and changed end state that supports the next order of magnitude. **Fail condition:** a unit is only a container for events, exposition, or mood. **Owner:** `SeasonPlannerAgent` for season/arc/episode structure, `StoryArchitect` for scenes and `sceneEpisodes`, and `SceneCraftValidator` or a structural diagnostic for missing scene-level turns. |
| **P5. Theme generates plot.** Theme is the question the story is asking. Every plot event should press on that question. | Add as theme-pressure rule | **Theme As Plot Pressure.** The season must have a working theme question, and every episode must test that question through conflict, choice, cost, relationship pressure, information, or identity movement. Major scenes and major choices must either press the theme question, complicate it, answer it temporarily, or force the protagonist to act against it. **Pass condition:** the player can identify how the episode's major conflict tests the theme. **Fail condition:** theme exists only as a noun in metadata or as dialogue moralizing, while plot events could belong to any story. **Owner:** `SourceMaterialAnalyzer` should derive the theme question, `SeasonPlannerAgent` should assign episode angles, and `StoryArchitect`/`ChoiceAuthor` should make theme pressure playable. |
| **P6. Earned over arbitrary.** Subversion, escalation, and reveals must be set up before payoff. | Add as non-negotiable continuity rule | **No Unearned Payoffs.** Every reveal, reversal, escalation, rescue, betrayal, power shift, and climactic solution must have prior setup proportional to its importance. **Pass condition:** the payoff feels surprising in the moment but inevitable in retrospect because earlier scenes planted evidence, pressure, motive, cost, or capability. **Fail condition:** the story relies on unplanted reveals, sudden competence, convenient rescue, arbitrary escalation, or twist-for-twist's-sake. **Owner:** existing `ThreadPlanner`, `SetupPayoffValidator`, `TwistArchitect`, `TwistQualityValidator`, and `PixarPrinciplesValidator`; the rule should be elevated in the editorial contract even though the enforcement machinery already exists. |
| **P7. Information is fuel.** Who knows what when is a tension resource. Default to dramatic irony over mystery. | Add as information-management rule | **Information Has Ownership.** Every major piece of information must declare who knows it: player/audience, protagonist, ally, antagonist, or world. The default tension mode should be dramatic irony or suspense, where the player knows enough to feel pressure, with mystery used deliberately and answered on purpose. **Pass condition:** major clues, secrets, threats, and open questions have planned ownership, reveal timing, and payoff. **Fail condition:** mysteries pile up without answers, reveals appear from nowhere, or the player lacks enough information to make meaningful fiction-first choices. **Owner:** extend `ThreadPlanner` and narrative thread tags before adding a new agent; add an information-debt diagnostic later if needed. |
| **P8. No status quo restoration.** Each unit must change the situation. Characters cannot reset to their starting condition. | Add as state-change rule | **No Reset Units.** Every scene, `sceneEpisode`, episode, arc, and season must leave a residue: changed information, leverage, relationship, identity, resource, danger, promise, wound, location access, reputation, or future option. Reconvergence is allowed; emotional and causal reset is not. **Pass condition:** after the unit, someone knows, wants, risks, owes, fears, controls, has lost, or can do something different. **Fail condition:** the unit can be removed without changing future choices, relationships, knowledge, pressure, or character state. **Owner:** `StoryArchitect`, `SceneWriter`, `ChoiceAuthor`, `CharacterArcTracker`, callback/branch validators, and `SceneCraftValidator` final-beat checks. |

## Section 2: Generation Workflow

| Rule | Decision | Assessment |
|---|---:|---|
| **1. Establish Series Premise.** Genre, world, engine, thematic question. | Ignore | Already covered by `SourceMaterialAnalyzer`, `SeasonPlannerAgent`, world building, and season plan fields. |
| **2. Define Protagonist's Lie.** False belief, wound, truth. | Modify + add | Useful if softened. Add "false belief / pressure point / avoided truth" as an optional arc lens. Avoid forcing every protagonist into a trauma-wound template. |
| **3. Build Stakes Layers.** Material, relational, identity, existential. | Add | Strong compact rubric. Good for season planning, episode planning, encounter planning, and choice stakes. |
| **4. Plan Season Architecture.** Season dramatic question, arc, central pressure, tent-poles. | Ignore | Already covered by `SeasonPlannerAgent`, seven-point anchors, structural roles, encounter plan, and cliffhanger plan. |
| **5. Break Arcs Within Season.** Multi-episode arcs with own questions. | Modify + add | Useful for longer seasons only. StoryRPG should not force arc subdivisions into one-shots or short seasons. Add guidance only when `totalEpisodes` supports multi-episode arcs. |
| **6. Beat Episodes.** Act structure, A/B/C plot relationships, act-outs. | Modify + add | Keep "episode dramatic question and turns." Do not require 4-5 acts or A/B/C plot architecture. Map act-outs to existing episode turns, cliffhanger plan, scene final beats, and structural roles. |
| **7. Compose Scenes.** Goal, obstacle, choice, exit. | Ignore | Already covered by `StoryArchitect`, `SceneWriter`, `SceneCraftValidator`, `sequenceIntent`, `dramaticQuestion`, `conflictEngine`, and choice point logic. |
| **8. Revise Bottom-Up.** Verify scene -> episode -> arc -> season service. | Add | Good as a diagnostic and optional validation summary: after generation, review whether scene takeaways serve episode question and whether episode endings serve season anchors. |

## Section 3: Theme

| Rule | Decision | Assessment |
|---|---:|---|
| **T1. Theme must be stated as a question, not a noun.** | Modify + add | Good concept, but avoid schema migration unless needed. Existing `themes: string[]` can remain. Add prompt guidance to convert theme nouns into a working theme question internally, such as "What do you owe family when loyalty costs your selfhood?" |
| **T2. Theme must be answerable by the protagonist's choices, not by external events.** | Add | Excellent StoryRPG fit. This should influence major choices, ending targets, and identity/relationship consequences. |
| **T3. Each episode should illuminate the theme from a different angle. Never state the theme directly through dialogue.** | Modify + add | Add as season-planning guidance. Soften "each episode" for short stories. Keep the anti-sermon rule because it aligns with subtext and fiction-first prose. |
| **T4. The B-plot must thematically rhyme with the A-plot.** | Modify + add | Revised after episode-pressure planning: B-plots are valid when treated as protagonist-facing relationship/identity pressure lanes, not separate POV subplots. They may be a scene, a `sceneEpisode`, an underlay, or offscreen pressure surfaced through visible signals. |
| **T5. Scene belongs if it presses on the theme question.** | Modify + add | Good diagnostic, but not the only reason a scene belongs. A scene can belong because it sets up information, consequence, relationship residue, player agency, pacing contrast, or visual/emotional aftermath. |

## Section 4: Character Architecture

| Rule | Decision | Assessment |
|---|---:|---|
| **C1. Every protagonist has a Lie.** | Add | Implement as agent-facing `characterArchitecture.protagonist.lie`: a false/protective belief or identity distortion. It is planning pressure, never player-facing label text. |
| **C2. The Lie has a Wound.** | Modify + add | Implement as `originPressure`, not mandatory trauma. It may be a past event, pressure, loss, success, humiliation, betrayal, deprivation, vow, social condition, or survival adaptation that made the Lie useful. |
| **C3. The Lie has a Truth.** | Add | Implement as `truth`: what the protagonist must recognize, integrate, or tragically refuse. Feed this into arc pressure, episode choice pressure, and climax behavior. |
| **C4. Plot must pressure the Lie.** | Add strongly | Season arcs now align `identityPressureFacet` to the protagonist Lie/Truth/Need. Generic obstacles should warn when they do not make the false belief harder to sustain. |
| **C5. The arc resolves with a choice.** | Add strongly | Implement as `climaxChoice`: choice question, integrate-Truth option, recommit-Lie option, and active choice mechanism. The climax must resolve through protagonist/player action. |
| **C6. Want vs. Need.** | Strengthen existing | Keep scene-level `wantVsNeed`, and add season/protagonist-level `want` and `need`. Validator warns if they collapse into the same goal. |
| **C7. Supporting characters need micro-Lies.** | Modify + add | Implement only for core/supporting NPCs through scaled `supportingCharacters` micro-arcs with protagonist-visible signals. Minor NPC micro-Lies warn rather than block. |
| **C8. Character agency check.** | Strengthen existing | Keep the 60% protagonist-driven plot rule under dramatic structure. Character Architecture reinforces it through active climax choice and choice-driven Lie/Truth pressure. |

### Section 4 Implementation Notes

Implemented as **Character Architecture**:

- `SourceMaterialAnalysis` and `SeasonPlan` now carry `characterArchitecture`.
- The protagonist architecture includes `lie`, `originPressure`, `truth`, `want`, `need`, `arcMode`, and `climaxChoice`.
- Supporting character micro-arcs include `microLie`, optional `originPressure`, `truthOrCounterPressure`, screen-time tier, pressure role, protagonist-visible signals, and optional resolution.
- `SourceMaterialAnalyzer` asks for this architecture and normalizes fallbacks so prompt-only or thin-source generations still get usable pressure.
- `SeasonPlannerAgent` carries the architecture forward and uses it when normalizing arc identity pressure.
- `StoryArchitect` receives the architecture as episode directive context and is instructed to express it through choices, costs, behavior, subtext, and consequences rather than labels.
- `CharacterArcTracker` receives character architecture as agent-facing pressure for identity/relationship target selection.
- `CharacterArchitectureValidator` checks required protagonist fields, Want/Need separation, active climax choice, supporting micro-arc visibility, and arc identity alignment.

## Section 5: Stakes Architecture

| Rule | Decision | Assessment |
|---|---:|---|
| **S1. Material stakes.** | Add | Useful category for planning, though it should not dominate. |
| **S2. Relational stakes.** | Add | Strong fit for StoryRPG relationships and callbacks. |
| **S3. Identity stakes.** | Ignore | Already core to `STAKES_TRIANGLE`, choice impact factors, identity axes, and `CharacterArcTracker`. |
| **S4. Existential stakes.** | Modify + add | Keep but define broadly: survival of self, others, home, future, community, meaning, freedom, or selfhood. Must be grounded personally. |
| **S5. Stack at least three layers per major scene.** | Modify + add | Good target for major scenes and encounters. Do not require every scene to hit a hard count. Use "major scenes should usually carry multiple stakes layers." |
| **S6. Escalate gradually.** | Add | Good anti-regression rule. It prevents episodes from jumping to apocalyptic pressure before player investment exists. |
| **S7. Personal first, then expand.** | Add | Strong fit. Add to `SeasonPlannerAgent` and `StoryArchitect` as stakes grounding. |
| **S8. Stakes ladder within a scene.** | Modify + add | Use current "accumulate pressure toward keyMoment" language. Do not force every beat to be higher intensity because `NARRATIVE_INTENSITY_RULES` deliberately preserves rest beats. |

## Section 6: Scene-Level Rules

| Rule | Decision | Assessment |
|---|---:|---|
| **SC1. Entry goal.** | Add | Elevate from prompt guidance into the Scene Turn Contract. Every planned scene should show entry intent through `dramaticQuestion`, `wantVsNeed`, choice stakes, or `sequenceIntent.objective`. |
| **SC2. Obstacle.** | Add | Elevate from prompt guidance into the Scene Turn Contract. Every planned scene should name active resistance through `conflictEngine`, `sequenceIntent.obstacle`, encounter pressure, or the scene turn. |
| **SC3. Choice forced.** | Modify + add | Add as dramatic decision pressure, not always a literal visible player choice. Every planned scene must force a player choice, character commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction. |
| **SC4. Exit shift.** | Add | Elevate from prompt guidance into the Scene Turn Contract. Every planned scene should leave changed emotional, strategic, relational, informational, material, or identity footing through `changedState`, `endState`, residue, or transition pressure. |
| **SC5. Power dynamic shifts.** | Modify + add | Add as conditional Scene Turn Contract enforcement. Multi-character major scenes and `sceneEpisodes` need a power shift; quieter multi-character scenes may shift trust, vulnerability, intimacy, distance, leverage, information, or status rather than dominance. |
| **SC6. Connection rule.** | Ignore | Already implemented through P1: `transitionOut` must connect reachable scenes via "therefore" or "but", not simple chronology. Do not duplicate this validator. |
| **SC7. Removability test.** | Add | Add as Scene Turn Contract enforcement. A scene must change information, relationship, identity, resource/access, danger, promise/setup/payoff, choice consequence, theme pressure, stakes, route state, or emotional footing. |
| **SC8. Subtext over text.** | Modify + add | Keep as prompt and SceneCraft diagnostic, not a hard universal error. Confessions, tactics, vows, comedy, ritual, and catharsis sometimes require direct speech. |
| **SC9. Length discipline.** | Modify + add | Keep through beat/word budgets plus prompt guidance: start late, leave once the turn, decision, consequence, or handoff lands. Avoid a hard validator for subjective length. |

## Section 7: Episode-Level Rules

| Rule | Decision | Assessment |
|---|---:|---|
| **E1. Dramatic question.** | Strengthen existing | `dramaticAudit.episodeQuestion` exists. Add `episodeQuestionSetup` and `episodeQuestionAnswer` so the opening poses/promises the question and the climax/major turn answers, complicates, or reframes it. |
| **E2. Act structure. Use 4-5 acts.** | Modify + add lightly | Do not require literal 4-5 acts. Use existing `majorTurns` as episode turns with `turnType` (`reversal`, `revelation`, `escalation`, `choice`, `cost`, `payoff`). |
| **E3. Act-outs.** | Modify + add | Adapt to turn-outs: significant episode turns should close/alter current pressure, open sharper pressure, and land a memorable image, line, reveal, choice, cost, or emotional beat. |
| **E4. A/B/C plot architecture.** | Add as pressure lanes | A-plot is required external pressure. B-plot is protagonist-facing relationship/identity pressure and may be a scene, `sceneEpisode`, underlay, or offscreen pressure surfaced through signals. C-plot is planted future pressure, usually not its own scene. |
| **E5. Story circle default episode shape.** | Ignore | Do not implement. It competes with the established seven-point season spine and risks formulaic output. |
| **E6. Episode-level character change.** | Strengthen existing | Already covered by `CharacterArcTracker`, `ArcDeltaValidator`, choices, relationship deltas, identity axes, and P8. Add `episodeEndStateDelta` as an episode-level audit field; change can be small, negative, relational, informational, strategic, or identity-based. |
| **E7. No status quo restoration.** | Ignore as separate rule | Already covered by P8, Scene Turn Contract exit shift, residue, branch residue, and `episodeEndStateDelta`. Do not add duplicate validation. |
| **E8. Forward momentum.** | Strengthen existing | Already covered by `CliffhangerPlan`, `CliffhangerValidator`, SceneWriter final-scene guidance, and cliffhanger planning. Add `nextEpisodePressure` to the episode audit for non-finale episodes, while allowing finales/resolutions to close with aftermath or legacy. |
| **E9. Cold open function.** | Add as Opening Promise | Use "Opening Promise," not TV cold open. Normal episodes: first scene establishes hook, episode promise, active pressure, and optional stakes. `sceneEpisodes`: the first beat or first 1-2 beats must carry pressure, desire, threat, question, choice, revelation, or relationship tension. |

## Section 8: Arc-Level Rules

| Rule | Decision | Assessment |
|---|---:|---|
| **A1. Arc dramatic question.** | Add | Define an arc as a 3-8 episode pressure movement inside the season, not a TV act and not a competing spine. Each arc needs `arcQuestion`, narrower than but related to the season question, stakes, goal, or theme pressure. |
| **A2. Episode-as-act-break.** | Modify + add | Do not implement literal acts. Use **episode-as-arc-turnout**: each episode ending inside an arc must escalate, reverse, reveal, cost, force a choice, recontextualize, crisis-hit, finale-answer, or hand off pressure. |
| **A3. Midpoint recontextualization.** | Add | Add arc-level `midpointRecontextualization` while keeping the season `midpoint` authoritative. The arc midpoint must change the question being asked, not merely intensify danger. |
| **A4. All-is-lost beat.** | Modify + add | Implement as `lateArcCrisis`: apparent failure, irreversible cost, or collapse of the current plan near the final third. Do not require genre-inappropriate despair or "hope cancelled" in every arc. |
| **A5. Earned escalation.** | Add strongly | Add `episodeTurnouts[].whyThisCannotMoveLater` and `leavesProtagonistWith` so episodes inside an arc are not reorderable. Each episode must leave damage, knowledge, obligation, exposure, compromise, relationship pressure, choice residue, or future pressure. |
| **A6. Arc finale not season finale.** | Add conditionally | Non-final arcs need `finaleAnswer` plus `handoffPressure`. If the arc ends on the season finale, the season resolution can supersede handoff pressure. |
| **A7. Arc-character alignment.** | Modify + add | Use `identityPressureFacet`, not mandatory "Lie" terminology. It may be a false belief, wound, fear, vow, loyalty, ambition, self-image, or value conflict. |

### Section 8 Implementation Notes

Implemented as **Arc Pressure Architecture**:

- `SeasonArc` now carries `arcQuestion`, `seasonQuestionRelation`, `identityPressureFacet`, `midpointRecontextualization`, `lateArcCrisis`, `finaleAnswer`, `handoffPressure`, and per-episode `episodeTurnouts`.
- `SeasonPlannerAgent` prompts for these fields and normalizes fallback values from the existing season plan, cliffhanger plan, protagonist arc, and seven-point roles.
- `ArcPressureArchitectureValidator` validates arc questions, identity pressure, midpoint recontextualization, late crisis, finale/handoff behavior, 3-8 episode target range, and complete non-flat episode turnouts.
- `planningHelpers` passes the active arc and current episode turnout into `StoryArchitect`.
- `StoryArchitect` uses the current arc turnout as episode guidance while preserving the existing season 7-point spine.
- In `sceneEpisodes` mode, an arc is a chain of scene-length runtime episodes. Each sceneEpisode carries only its assigned arc turnout; the chain as a whole carries setup, recontextualization, crisis, finale, and handoff.

## Section 9: Season-Level Rules

| Rule | Decision | Assessment |
|---|---:|---|
| **SE1. Season dramatic question.** | Add | Implement as `seasonPromiseArchitecture.seasonDramaticQuestion`: one protagonist-centered question that fuses goal, stakes, and Lie/Truth pressure. It complements theme/arc questions and does not replace the seven-point spine. |
| **SE2. Pilot not typical episode.** | Strengthen existing | Episode 1 should establish premise, player role, protagonist pressure, dramatic engine, and promise of play. This belongs in Season Promise Architecture, not as a separate pilot exception schema. |
| **SE3. Re-pilot rule.** | Ignore / soften | Too TV-specific. Episode 2 may clarify the normal play/story engine when season length allows, but StoryRPG should not force a rigid re-pilot. |
| **SE4. Tent-pole episode positions.** | Ignore as structure | The existing `sevenPointDistribution.ts` maps tent-pole functions across any episode count. Do not add fixed episode positions or conflicting TV formulas. |
| **SE5. Penultimate-episode rule.** | Ignore | Too prescriptive. StoryRPG's climax should follow the seven-point `climax` role and user/source constraints; sometimes finale must contain climax and resolution. |
| **SE6. Season as complete unit.** | Add | Implement as `seasonCompleteness`: resolved question, resolved stakes, character state change, and optional earned future pressure. Future hooks must not erase season satisfaction. |
| **SE7. Earned escalation across seasons.** | Defer | Good future multi-season guidance, but not a validator now. Current scope is a single season plus optional future pressure. |
| **SE8. Big Bad / central pressure.** | Modify + add | Implement as `centralPressure`, not mandatory villain. It can be a person, institution, mystery, environment, relationship, internal force, or situation. |
| **SE9. Promise of the premise.** | Add | Implement as `seasonPromise`: premise promise, player-experience promise, emotional promise, and variation plan. This prevents drift without rigid episode formulas. |
| **SE10. Operational theme.** | Strengthen existing | Already covered by Theme Pressure and Character Architecture. Season Promise keeps the core concern visible across the season without forcing thesis dialogue. |

### Section 9 Implementation Notes

Implemented as **Season Promise Architecture**:

- `SeasonPlan` now carries `seasonPromiseArchitecture`.
- The architecture includes `seasonDramaticQuestion`, `centralPressure`, `seasonPromise`, and `seasonCompleteness`.
- `SeasonPlannerAgent` prompts for the architecture and normalizes fallbacks from anchors, character architecture, Episode 1, and finale planning.
- `SeasonPromiseValidator` checks required fields, central pressure/Lie alignment, player-experience promise, Episode 1 premise signal, finale completeness, and future-pressure wording.
- `planningHelpers` passes the season promise contract into `StoryArchitect`.
- `StoryArchitect` uses the contract to establish, vary, complicate, pay off, or hand forward the season promise without adding fixed TV tent-poles.
- `sceneEpisodes` mode treats Episode 1 as the premise/player-role sceneEpisode and the finale sceneEpisode as the completeness/residue sceneEpisode; no rigid re-pilot or penultimate-climax rule is forced.

## Section 10: Information Management

| Rule | Decision | Assessment |
|---|---:|---|
| **I1. Three states of information.** Shared with audience, withheld from audience, selectively shared. | Add | Implement as `audienceKnowledgeState`: `shared`, `withheld`, or `selective`, with explicit `knownBy` / `withheldFrom` holders. |
| **I2. Default to dramatic irony.** | Modify + add | Use suspense/dramatic irony by default when it can be expressed through protagonist-visible evidence, player-known route state, NPC behavior, or environmental threat without breaking POV. |
| **I3. Use mystery sparingly. Limit 1-3 box questions per season.** | Add with hard cap | Implement a hard cap of 3 mystery/box-question ledger entries per season. Excess mysteries should become suspense, dramatic irony, foreshadowing, or revelation. |
| **I4. Use surprise structurally. Save surprise for act-outs and finales.** | Strengthen existing | Keep surprise as an information mode tied to major turns, cliffhangers, reversals, or finales. Do not reuse the same setup for repeated surprises. |
| **I5. The bomb principle. Suspense over surprise.** | Add | Implement through ledger `tensionMode`: prefer `suspense` or `dramatic_irony` for threats, betrayals, deadlines, traps, and social danger. |
| **I6. Plant 5-8 episodes ahead.** | Add with mode-specific runway | Enforce plant/payoff runway: 5-8 `sceneEpisodes` or 3-4 standard episodes, except very short seasons that cannot support the runway. |
| **I7. Third time pays for all.** | Modify + add | Major payoffs use `setupTouchEpisodes`; the runway rule creates repeated touch opportunities. Do not require three touches for tiny callbacks. |
| **I8. Audit unanswered questions.** | Add | Ledger tracks `opensQuestionIds` and `closesQuestionIds`; validator requires the season to close at least as many major questions as it opens, and ideally more. |

### Section 10 Implementation Notes

Implemented as **Information Ledger**:

- `SeasonPlan` now carries `informationLedger`.
- Ledger entries track audience knowledge state, tension mode, who knows, who does not know, introduction, reveal, payoff, setup touches, payoff plan, box-question status, and opened/closed question IDs.
- `SeasonPlannerAgent` prompts for the ledger and normalizes fallback entries from season central pressure and arc recontextualization.
- `InformationLedgerValidator` enforces the hard cap of 3 mysteries/box questions, reveal/payoff planning for mysteries, valid knowledge ownership, payoff after setup, required runway of 5-8 `sceneEpisodes` or 3-4 regular episodes, and net question closure.
- `planningHelpers` passes only episode-relevant ledger entries into `StoryArchitect`.
- `StoryArchitect` uses the entries to plant, touch, reveal, pay off, close, or sharpen information without early reveals or POV breaks.
- `sceneEpisodes` should perform one clean information job per scene-length episode: plant, touch, reveal, pay off, close, or sharpen one question.

## Section 11: Failure Mode Checklist

| Rule | Decision | Assessment |
|---|---:|---|
| **F1. Escalation trap.** | Add | Good diagnostic. Prevents stakes from rising faster than player investment. |
| **F2. Mystery box collapse.** | Add | Good diagnostic. Pairs with information ledger/open-question audit. |
| **F3. Character drift.** | Add | Useful QA rule. Could be handled through CharacterArcTracker targets, NPC voice/arc fields, and optional LLM critique. |
| **F4. Shaggy dog.** | Ignore | Already covered by setup/payoff validators and thread priority. |
| **F5. Passive protagonist.** | Modify + add | Same as P2/C8. Preserve the 60%+ protagonist-caused standard for plot turns, and map failures into a shared passive-protagonist diagnosis. |
| **F6. Reset disease.** | Ignore | Already covered by residue, callbacks, arc deltas, and no emotional reset rules. |
| **F7. Theme drift.** | Add | Useful diagnostic. Could be LLM-based or heuristic using scene takeaways, episode synopsis, and theme question. |
| **F8. Unmotivated escalation.** | Add | Useful diagnostic. Escalation should flow from character choice, prior consequences, antagonist pressure, environment, or revealed information. |
| **F9. Snowglobe arcs.** | Ignore | Already addressed by no status quo restoration, branch residue, and consequence memory. |
| **F10. Inverted thematic rhyme.** | Modify + add | Use only when a secondary plot/pressure exists. Do not force every episode into A/B plotting. |
| **F11. Convenient coincidence.** | Modify + add | Existing Pixar causality coverage is encounter-focused. Add a final-scene diagnostic so climaxes/resolutions cannot be solved by outside rescue, luck, prophecy, villain-only action, or arbitrary arrival. |
| **F12. Telegraphed twist.** | Add | Real gap. `TwistQualityValidator` checks that setup exists and precedes reveal; it does not detect over-foreshadowing or obvious twists. Add a heuristic diagnostic for repeated clue phrasing. |
| **F13. Cheating twist.** | Ignore | Already covered by `TwistQualityValidator` and `SetupPayoffValidator`. |

### Section 11 Implementation Notes

Implemented as **Narrative Failure Mode Diagnostics**:

- `NarrativeFailureModeValidator` translates existing validator issues into the F1-F13 editorial vocabulary so the checklist becomes a shared diagnosis layer instead of thirteen duplicate validators.
- Existing validators remain the source of truth for most failures: stakes/structure validators cover F1 and F8; information ledger covers F2; character architecture and arc delta cover F3; setup/payoff and callbacks cover F4 and F13; P2/C8 agency checks cover F5; scene/episode/arc residue covers F6 and F9; theme pressure covers F7; A/B pressure-lane rhyme covers F10.
- F11 now has a direct final-scene heuristic: endings are flagged when they appear to resolve through outside rescue, luck, fate, prophecy, arbitrary authority arrival, or someone else solving the problem without visible protagonist/player agency.
- F12 now has a direct clue-density heuristic: repeated obvious phrases such as "something is off" or "not what it seems" warn that a twist is being over-telegraphed.
- `runNarrativeDiagnostics` now includes a `failure_modes` check that aggregates prior issues and scene-level signals into the failure-mode report.
- The check is advisory in the diagnostics runner, but it can still produce `error` severity for hard editorial failures such as coincidence solving the ending.
- This avoids regression by preserving current validator ownership and adding only the missing detection gaps.

## Section 12: Genre Adjustments

| Rule | Decision | Assessment |
|---|---:|---|
| **G1. Procedural.** | Modify + add | Useful genre override: more weekly closure is acceptable, while character/relationship accumulation remains required. |
| **G2. Serialized drama.** | Modify + add | Useful genre override: stronger arc continuity, less reset, tighter theme coherence. |
| **G3. Sitcom.** | Modify + add | Useful if StoryRPG generates comedy/sitcom-like stories. Permit lighter plot reset while preserving relationship/identity residue. |
| **G4. Limited series.** | Modify + add | Good override: treat the whole season as the complete arc, with less need for ongoing-series hooks. |
| **G5. Anthology.** | Modify + add | Good override: apply season rules to the relevant unit and preserve thematic coherence across standalone worlds. |

## Recommended Implementation Shape

Add a compact craft layer rather than importing the whole source file verbatim.

Recommended prompt additions:

- **Theme pressure**: convert theme nouns into a working question; major choices should answer, complicate, or refuse that question.
- **Personal stakes before scale**: every large threat should be grounded in a concrete person, bond, place, promise, identity, or cost.
- **Protagonist agency**: major resolutions should come from player/protagonist action, commitment, sacrifice, preparation, relationship leverage, or information use.
- **Information management**: decide what the audience knows, what the protagonist knows, what NPCs know, and which major questions need planned answers.
- **Earned escalation**: later pressure should grow from prior choices, consequences, antagonizing force, discoveries, or relationship changes.
- **Arc pressure architecture**: arcs are 3-8 episode pressure movements inside the season seven-point spine, with arc questions, midpoint recontextualization, late crisis, finale answer, handoff pressure, and non-swappable episode turnouts.
- **Character architecture**: protagonist Lie/origin pressure/Truth/Want/Need/climax choice, with supporting micro-Lies scaled to screen time and kept protagonist-visible.
- **Season promise architecture**: one season dramatic question, central pressure, premise/player/emotional promise, fresh variation plan, and season completeness target without fixed TV episode positions.
- **Information ledger**: track who knows what, mystery cap, suspense/default dramatic irony, setup runway, payoff plan, and opened/closed questions.
- **Failure mode diagnostics**: before finalizing any unit, map validation issues to F1-F13 and directly check endings for convenient coincidence and twist setups for over-obvious clue repetition.
- **Genre overrides**: procedural, serialized drama, sitcom/comedy, limited series, and anthology structures can relax or emphasize different rules.

Best implementation surfaces:

- `SourceMaterialAnalyzer`: infer a theme question, central pressure, and Character Architecture when source material only provides broad themes.
- `SeasonPlannerAgent`: add compact guidance for theme question, central pressure, personal stakes, information ledger, arc pressure architecture, Character Architecture, Season Promise Architecture, and genre override.
- `StoryArchitect`: add episode dramatic question, causal scene transitions, protagonist agency, earned escalation guidance, current episode's arc turnout, current Lie/Truth pressure, season promise pressure, and episode-relevant information ledger entries.
- `ThreadPlanner`: extend prompt usage so mystery questions, dramatic-irony threats, and reveal promises can be tracked as threads.
- `CharacterArcTracker`: incorporate Lie / origin pressure / Truth / Want-vs-Need pressure when available, without requiring a trauma wound.
- `SceneWriter`: minimal changes only; most scene-level rules are already present.
- Validators/diagnostics: add lightweight checks only where the repo has real gaps.

Avoid:

- Adding 4-5 act structure as a hard rule.
- Requiring A/B/C plots for every episode.
- Requiring pilot/re-pilot structure.
- Forcing the biggest event into the penultimate episode.
- Enforcing the 60% protagonist-causality target as hard validator math; keep it as a planning audit target.
- Requiring every scene to have a midpoint, all-is-lost beat, or literal theme proof.
- Requiring all characters to have a Lie/Wound/Truth arc.
- Creating new runtime schema unless a repeated implementation need appears.

## Suggested Diagnostics

Prefer diagnostics and repair feedback over hard validators for subjective storytelling craft.

Potential diagnostics:

- **ThemePressureDiagnostic**: checks whether the theme is a playable question, major choices can answer it, each episode has a distinct angle, and scenes press or pay off it without direct thesis dialogue. B-plots are handled separately as protagonist-facing relationship/identity pressure lanes when episode architecture calls for them.
- **AgencyDiagnostic**: flags climaxes/resolutions that are solved by coincidence, external rescue, or passive revelation rather than protagonist/player action.
- **StakesLayerDiagnostic**: checks that stakes layers define the pressure while the Stakes Triangle makes that pressure playable. Major scenes and encounters should name at least two of material, relational, identity, or existential stakes; dilemmas and climaxes must include relational or identity stakes; existential stakes must be personally grounded.
- **InformationDebtDiagnostic**: tracks major open questions, who knows what, whether answers are planned, and whether the season closes more major questions than it opens.
- **EscalationDiagnostic**: flags sudden stakes jumps not grounded in prior choice, consequence, discovery, or antagonist pressure.
- **ArcPressureArchitectureValidator**: validates arc questions, identity pressure facets, midpoint recontextualization, late crisis, finale/handoff behavior, and per-episode turnouts so arc episodes cannot be swapped without consequence.
- **CharacterArchitectureValidator**: validates protagonist Lie/origin pressure/Truth/Want/Need/climax choice, supporting micro-Lie visibility, and arc identity-pressure alignment.
- **SeasonPromiseValidator**: validates season dramatic question, central pressure, premise/player/emotional promise, Episode 1 promise signal, finale completeness, and earned future pressure.
- **InformationLedgerValidator**: validates information ownership, hard cap of 3 mysteries/box questions, reveal/payoff planning, setup runway, and opened/closed question balance.
- **TwistSubtletyDiagnostic**: flags over-telegraphed twists, repeated obvious clue wording, or reveals that are too predictable despite being technically foreshadowed.

These should start as warnings or suggestions. Hard errors should remain reserved for structural contract failures, mechanics leakage, invalid graph/routing, missing setup/payoff, or broken output schema.

## Skills And Agents Assessment

### Existing Skills To Use

- **`storyrpg-narrative-validation`**: primary skill for adapting these rules because it covers narrative QA, seven-point structure, setup/payoff, branch divergence, choice density, and fiction-first mechanics.
- **`storyrpg-testing-validation`**: use when planning or implementing validator tests, focused Vitest runs, type checks, and verification notes.
- **`storyrpg-pipeline-debugging`**: use if prompt/validator changes cause stuck jobs, generation failures, retries, or pipeline checkpoint problems.
- **`storyrpg-reader-playback`**: use only if new rules affect playback experience, player state, choice presentation, or fiction-first UI.

### New Agents

No new generation agent is required for a first implementation pass.

The current agents already have natural ownership:

- `SeasonPlannerAgent` owns season structure, theme pressure, central pressure, stakes, and genre override.
- `StoryArchitect` owns episode dramatic question, causal scene graph, player agency, and escalation.
- `ThreadPlanner` owns setup/payoff, mystery questions, dramatic-irony threats, and reveal promises.
- `CharacterArcTracker` owns identity pressure and protagonist growth.
- `SceneWriter` owns scene-level prose craft.

Adding a new generation agent too early would increase orchestration complexity and risk duplicating existing responsibilities.

### Possible Future Agent Or Diagnostic

If generated stories continue to show theme drift, passive protagonists, mystery debt, or unearned escalation after prompt tuning, add one lightweight post-planning diagnostic rather than a full generation agent:

**NarrativePressureAuditor**

Responsibilities:

- Check theme pressure across episode plan and scene takeaways.
- Check protagonist/player agency in major turns.
- Check information debt and planned answers.
- Check escalation causality.
- Check over-foreshadowed twists.
- Emit warnings and targeted repair suggestions.

This should run after `SeasonPlannerAgent` and/or `StoryArchitect`, and possibly after scene generation as a post-generation diagnostic. It should not own story generation.

### ThreadPlanner Extension Preferred Over New Information Agent

For information-management rules, extend `ThreadPlanner` before adding a new agent.

Recommended adaptation:

- Treat major open questions as `NarrativeThread` entries.
- Use tags such as `mystery`, `dramatic-irony`, `reveal`, `threat`, `relationship-secret`, and `season-question`.
- Require major questions to have planned payoffs or explicit carry-forward intent.
- Use `SetupPayoffValidator` and a future `InformationDebtDiagnostic` to surface unresolved major questions.

This preserves the existing setup/payoff architecture and avoids adding a parallel ledger.

## Overall Recommendation

Adopt the ruleset selectively.

Add or adapt the rules that improve StoryRPG's weak spots:

- Theme as playable pressure.
- Personal stakes before scale.
- Stakes layers as the pressure taxonomy: material, relational, identity, existential.
- Protagonist/player agency.
- Information management.
- Earned escalation.
- Genre-aware structural flexibility.
- Over-foreshadowed twist detection.

Do not add duplicate machinery for rules already owned by validators, and do not impose rigid TV formulas:

- 4-5 act episode structure.
- Mandatory A/B/C plots.
- Pilot/re-pilot requirements.
- Penultimate-episode climax rule.
- Hard validator enforcement of 60% protagonist causality; keep 60% as a planning target.
- Mandatory Lie/Wound/Truth for every character.
- Every level needing its own midpoint/all-is-lost/climax.

The best near-term implementation is a small set of prompt fragments plus a few warning-level diagnostics, not a large schema refactor or a new fleet of agents.
