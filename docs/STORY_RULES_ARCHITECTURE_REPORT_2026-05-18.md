# Story Rules And Architecture Report Since 2026-05-18

**Status:** Durable project reference  
**Scope:** Story rules, story architecture, sceneEpisode work, and related pipeline behavior added or clarified since May 18, 2026  
**Primary audience:** StoryRPG maintainers, generation-pipeline agents, narrative QA agents, and future implementation agents

## Executive Summary

Since May 18, 2026, StoryRPG's story-generation rules have been strengthened in two stacked layers.

The first layer is the interactive-story foundation: meaningful agency, branch residue, delayed callbacks, setup/payoff discipline, fiction-first mechanics, choice density, convergent branching, and mechanical storytelling. This layer answers: **does the player action matter in the story, not just in hidden state?**

The second layer is the editorial-structure architecture: P1-P8, stakes, theme, character architecture, scene structure, episode pressure, arc pressure, season promise, information management, and failure mode diagnostics. This layer answers: **does every unit of story have causality, pressure, choice, consequence, escalation, and residue?**

The design thesis tying both layers together is:

> Choice causes consequence. Consequence creates residue. Residue drives the next unit.

This report combines the three recent narrative reports:

- main story pipeline changes since sceneEpisodes began
- full episodes versus sceneEpisodes impact
- P1-P8 / stakes / theme / scene / episode / arc / season architecture

It also folds in the immediately preceding story-rule foundation work around agency, branching, callbacks, setup/payoff, seven-point structure, fiction-first mechanics, mechanical storytelling, choice density, and branch divergence.

## Timeline Since May 18

This timeline separates committed repository milestones from current working-tree changes.

| Date | Status | Milestone | Narrative Significance |
|---|---|---|---|
| 2026-05-19 | Committed | Story playthrough QA strengthened | Improved story validation around player experience, choices, callbacks, branch quality, and generated-playthrough confidence. |
| 2026-05-19 | Committed | Shot variety planning added to pipeline | Adjacent visual-storytelling work. It supports story clarity by making generated episodes visually varied and scene-specific. |
| 2026-05-21 | Committed | Merge from upstream branch | Brought in surrounding project changes before later narrative work continued. |
| 2026-05-21 to 2026-05-22 | Committed | Story structure normalized and episode scene caps tightened | Reinforced bounded episode planning, normalized structural expectations, and reduced runaway scene counts. |
| 2026-05-24 | Committed | Narrative failure mode diagnostics | Added diagnostic vocabulary for common story failures such as passive protagonist, reset disease, unmotivated escalation, weak payoff, and twist problems. |
| 2026-05-24 | Committed | Current project status docs updated | Updated documentation to reflect the active pipeline and product split. |
| Current working tree | Uncommitted at time of report | sceneEpisode treatment parsing, strict editorial repairs, validators, and treatment fidelity fixes | Made sceneEpisodes first-class enough for treatment ingestion, one-scene planning, playable-contract repair, branchlet handling, and stricter dramatic audit/fidelity checks. |

## Earlier Story Rule Foundation

Before the P1-P8 editorial stack, StoryRPG already had an interactive-story quality foundation. These rules remain active and should not be replaced by the newer structure rules.

### Meaningful Agency

**Rule:** Every non-flavor choice should affect something real.

A meaningful choice can affect flags, relationships, identity, resources, access, future prose, future choice wording, callback hooks, route state, encounter posture, or later NPC behavior. A choice can be small and still matter if the story remembers it.

**Implementation status:** Hard validator plus prompt guidance.

**Primary enforcement:** Choice impact validation, callback validation, branch/residue validation, and StoryArchitect/ChoiceAuthor prompts.

### Stakes Triangle

**Rule:** Meaningful choices should carry Want, Cost, and Identity.

- **Want:** what the player is trying to get, protect, avoid, prove, learn, or become.
- **Cost:** what the choice risks immediately or later.
- **Identity:** what the choice says about who the protagonist is becoming.

The Stakes Triangle makes a choice playable. It does not replace the broader stakes-layer system added later.

**Implementation status:** Hard validator for high-impact choices, prompt guidance elsewhere.

**Primary enforcement:** `StakesTriangleValidator`, `ChoiceAuthor`, `StoryArchitect`, and integrated best-practices validation.

### Consequence Budget

**Rule:** Not every choice should become a major branch.

Choices can pay off through several consequence tiers:

| Consequence Tier | Use Case | Expected Effect |
|---|---|---|
| Callback | Low-cost memory | Future text, NPC line, motif, altered description, or remembered detail. |
| Tint | Local variation | Scene tone, relationship flavor, interiority, or altered beat without changing the graph. |
| Branchlet | Medium consequence | Short-lived route, alternate scene beat, altered encounter posture, or conditional moment. |
| Structural branch | Major turn | Distinct scene route or episode-scale divergence before planned reconvergence or separate payoff. |

**Implementation status:** Hard validator plus planning guidance.

**Primary enforcement:** Consequence budget validation, branch validators, callback ledger, ChoiceAuthor prompts.

### Convergent Spine With Residue

**Rule:** Branches may reconverge, but they must not erase choice residue.

StoryRPG favors a convergent narrative spine because it keeps generation tractable and preserves a strong authored season. But reconvergence is only acceptable when the path taken still leaves visible residue: relationship tone, altered leverage, knowledge, reputation, resource state, identity pressure, future affordance, or NPC memory.

**Implementation status:** Hard validator for branch residue and path divergence.

**Primary enforcement:** `SceneGraphBranchValidator`, `DivergenceValidator`, branch mechanical divergence checks, callback validation, and final story fidelity checks.

### Branch Divergence And No Cosmetic Branching

**Rule:** If two branches produce the same experience and the same future state, the branch is cosmetic.

A branch is strong when two players can compare notes and describe meaningfully different versions of the same story moment, even if the season later reconverges.

**Implementation status:** Hard validator and diagnostic.

**Primary enforcement:** `DivergenceValidator`, `SceneGraphBranchValidator`, and path simulation helpers.

### Delayed Memory And Callback Rules

**Rule:** Important choices should echo later.

Callbacks can appear as NPC recognition, altered prose, changed relationship tone, different available choices, visual state, clue access, future risk, or a line that lands differently because of prior action.

**Implementation status:** Hard validator plus prompt guidance.

**Primary enforcement:** `CallbackCoverageValidator`, `CallbackOpportunitiesValidator`, callback ledger, `ThreadPlanner`, and SceneWriter conditional text.

### Setup / Payoff And Earned Surprise

**Rule:** Important payoffs need prior setup proportional to their importance.

Plants, reveals, betrayals, rescues, twists, sudden competence, and climactic solutions should feel surprising in the moment but inevitable in retrospect.

**Implementation status:** Hard validator plus agent planning.

**Primary enforcement:** `ThreadPlanner`, `SetupPayoffValidator`, `TwistArchitect`, `TwistQualityValidator`, and later information ledger work.

### Seven-Point Season Spine

**Rule:** The season has a load-bearing seven-point structure.

The seven-point structure remains authoritative:

1. `hook`
2. `plotTurn1`
3. `pinch1`
4. `midpoint`
5. `pinch2`
6. `climax`
7. `resolution`

The newer arc, episode, and scene rules reinforce this spine. They do not replace it.

**Implementation status:** Hard validator at season-plan level.

**Primary enforcement:** `SevenPointCoverageValidator`, `sevenPointDistribution.ts`, `SeasonPlannerAgent`, and downstream structural context prompts.

### Pixar-Style Craft

**Rule:** Story moments need desire, pressure, earned surprise, and satisfying payoff.

This earlier craft layer emphasized:

- clear protagonist desire
- escalating pressure
- surprise with setup
- emotionally legible stakes
- payoff that satisfies the setup

**Implementation status:** Advisory and validator-backed depending on context.

**Primary enforcement:** `PixarPrinciplesValidator`, encounter surprise checks, StoryArchitect and EncounterArchitect prompts.

### Character Arc Delta

**Rule:** The story should produce character movement, not just plot movement.

Before the newer Lie/Truth architecture, StoryRPG already tracked identity and relationship movement through character arc targets and deltas. The newer character architecture gives that movement a clearer psychological structure.

**Implementation status:** Validator and planning agent.

**Primary enforcement:** `CharacterArcTracker`, `ArcDeltaValidator`, choice consequences, relationship consequences, and identity axes.

### Skill Surfaces And Fiction-First Mechanics

**Rule:** Hidden mechanics must surface through fiction.

The player should not see stats, dice rolls, or raw thresholds. Skills and attributes matter through:

- passive insight
- prepared advantage
- choice affordance
- outcome texture
- failure residue
- branch residue

Hard checks should usually have at least two fiction-first surfaces.

**Implementation status:** Hard validator and prompt guidance.

**Primary enforcement:** `SkillSurfaceValidator`, `StatCheckBalanceValidator`, `ChoiceAuthor`, `EncounterArchitect`, and the engine's fiction-first playback contract.

### Mechanical Storytelling Metadata

**Rule:** Mechanical consequences should be expressed as story verbs and visible residue.

Choices should not merely mutate invisible data. They should create fiction-visible effects through affordance sources, witness reactions, changed posture, consequence hints, reminder plans, and playable failure residue.

**Implementation status:** Hard validator plus metadata convention.

**Primary enforcement:** `MechanicalStorytellingValidator`, story verb helpers, branch mechanical divergence validation, and choice consequence metadata.

### Choice Density And First-Choice Rules

**Rule:** The player should not wait too long to act, and choices should be distributed enough to feel interactive.

Choice density rules protect the app from becoming passive prose. The exact density can vary by mode, genre, and episode length, but there must be enough meaningful action to support the StoryRPG promise.

**Implementation status:** Hard validator with configurable caps and thresholds.

**Primary enforcement:** `ChoiceDensityValidator`, integrated best-practices validation, StoryArchitect choice planning, and ChoiceAuthor.

### Scene Graph Branch Validity

**Rule:** Planned graph branches must route correctly and preserve residue.

Branches should not point backward, point to missing scenes, route to themselves, or disappear during assembly. Reconverged branches need visible bottleneck residue.

**Implementation status:** Hard validator, with sceneEpisode-specific exceptions for route-flag branchlets.

**Primary enforcement:** `SceneGraphBranchValidator`, dependency graph utilities, StoryArchitect branch repair, and FullStoryPipeline route cleanup.

## P1-P8 Core Principles

P1-P8 became the editorial spine above the interactive-story foundation. These rules are meant to be clear enough to drive editorial decisions without forcing stale formulas.

### P1. No "And Then" Scenes

**Final interpretation:** A scene cannot earn its place by happening next. Every scene transition must be explainable as **therefore** or **but**, not merely **and then**. The next unit must be necessary through consequence, reversal, discovery, cost, escalation, or choice residue.

**Purpose:** Prevent flat chronology and make every scene, sceneEpisode, and episode ending generate pressure for the next unit.

**Pass condition:** The outgoing beat changes what someone can do, knows, wants, risks, believes, controls, or must answer next.

**Fail condition:** The next scene could begin the same way if the prior scene were removed.

**Enforcement owner:** StoryArchitect for scene graph planning, SceneWriter for final beat handoff, DramaticStructureValidator and SceneTurnContractValidator for diagnostics.

**Player-agency interaction:** Player choices are one of the strongest forms of causal linkage. A choice should create residue that makes later events happen differently or mean something different.

**Status:** Hard validator where metadata exists; prompt guidance and repair layer elsewhere.

### P2. Protagonist-Driven Plot

**Final interpretation:** At least 60% of major plot turns should be caused or meaningfully reshaped by protagonist/player action.

Actions that count include choice, failed attempt, preparation, relationship leverage, information use, refusal, sacrifice, mistake, and identity commitment.

**Purpose:** Protect player agency and avoid stories where the protagonist merely witnesses external events.

**Pass condition:** Most major turns trace back to protagonist/player pressure.

**Fail condition:** The story advances mainly through external arrivals, coincidence, rescue, villain action, or revelations that happen without protagonist/player pressure.

**Enforcement owner:** SeasonPlannerAgent and StoryArchitect audit major turns; NarrativeFailureModeValidator diagnoses passive-protagonist patterns.

**Player-agency interaction:** The 60% target is a planning target, not hard semantic math. The important point is causal ownership, not exact counting.

**Status:** Planning audit and diagnostic warning. It should not become brittle hard math.

### P3. Personal Stakes Anchor

**Final interpretation:** Every episode and major scene must name the concrete personal stake underneath the plot stake.

Personal stakes can be a person, bond, place, promise, identity, reputation, memory, home, future, freedom, community, selfhood, or irreversible cost.

**Purpose:** Prevent abstract scale from replacing felt danger.

**Pass condition:** The player can say exactly what the situation costs the protagonist personally.

**Fail condition:** The stake is only world-ending danger, lore importance, generic urgency, or abstract scale.

**Enforcement owner:** SeasonPlannerAgent, StoryArchitect, EncounterArchitect, choice stakes metadata, DramaticStructureValidator.

**Player-agency interaction:** A choice matters more when the player understands what the protagonist personally stands to lose.

**Status:** Hard validator for major scenes and sceneEpisodes; prompt guidance for smaller bridge/rest scenes.

### P4. Dramatic Structure At Every Magnitude

**Final interpretation:** Every scene, sceneEpisode, episode, arc, and season needs its own dramatic shape: question or pressure, turn or recontextualization, pressure peak or highest cost, and resolution or changed state.

Lower levels reinforce higher levels:

```text
beat pressure -> scene shift -> sceneEpisode/episode turn -> arc movement -> season transformation
```

**Purpose:** Prevent units from becoming containers for exposition, mood, or disconnected events.

**Pass condition:** Each unit has a felt beginning, turn, pressure peak, and changed end state that supports the next order of magnitude.

**Fail condition:** A unit is only a container for events or information.

**Enforcement owner:** SeasonPlannerAgent for season/arc/episode structure; StoryArchitect for scenes and sceneEpisodes; SceneTurnContractValidator and DramaticStructureValidator for checks.

**Player-agency interaction:** Player choices can serve as turns, pressure peaks, or changed-state engines at any magnitude.

**Status:** Hard validator for blueprint metadata; prompt and repair layer for generated prose.

### P5. Theme As Plot Pressure

**Final interpretation:** Theme is the question the story is asking, and every episode should test that question through conflict, choice, cost, relationship pressure, information, or identity movement.

**Purpose:** Make theme operational instead of decorative.

**Pass condition:** The player can identify how the episode's major conflict tests the theme.

**Fail condition:** Theme exists only as a noun in metadata or thesis dialogue, while the plot could belong to any story.

**Enforcement owner:** SourceMaterialAnalyzer derives theme questions; SeasonPlannerAgent assigns angles; StoryArchitect and ChoiceAuthor make theme pressure playable; ThemePressureValidator checks output.

**Player-agency interaction:** The theme must be answerable, complicated, refused, distorted, or paid off through protagonist/player choices.

**Status:** Hard validator for major blueprint fields; prompt guidance against direct thesis dialogue.

### P6. No Unearned Payoffs

**Final interpretation:** Every reveal, reversal, escalation, rescue, betrayal, power shift, and climactic solution needs setup proportional to its importance.

**Purpose:** Preserve trust in the story and avoid arbitrary escalation or surprise for its own sake.

**Pass condition:** The payoff feels surprising in the moment but inevitable in retrospect.

**Fail condition:** The story relies on unplanted reveals, sudden competence, convenient rescue, arbitrary escalation, or twist-for-twist's-sake.

**Enforcement owner:** ThreadPlanner, SetupPayoffValidator, TwistArchitect, TwistQualityValidator, PixarPrinciplesValidator, InformationLedgerValidator.

**Player-agency interaction:** Player preparation and prior choices are preferred setup sources because they make payoffs feel earned and interactive.

**Status:** Hard validator where setup/payoff metadata exists; diagnostic elsewhere.

### P7. Information Has Ownership

**Final interpretation:** Every major piece of information should declare who knows it, when the player learns it, and how it pays off.

Knowledge owners can include audience/player, protagonist, ally, antagonist, world, institution, or specific NPCs.

**Purpose:** Treat information as tension fuel instead of accidental exposition.

**Pass condition:** Major clues, secrets, threats, and open questions have planned ownership, reveal timing, and payoff.

**Fail condition:** Mysteries pile up without answers, reveals appear from nowhere, or the player lacks enough information to make meaningful choices.

**Enforcement owner:** ThreadPlanner, InformationLedgerValidator, StoryArchitect dramatic audit, TreatmentFidelityValidator for authored information pressure.

**Player-agency interaction:** The player needs enough information to choose meaningfully, while selective withholding can create suspense, dread, misreadings, or delayed recontextualization.

**Status:** Hard validator for information ledger; prompt guidance for prose.

### P8. No Reset Units

**Final interpretation:** Every scene, sceneEpisode, episode, arc, and season must leave residue.

Residue can be changed information, leverage, relationship, identity, resource, danger, promise, wound, location access, reputation, future option, debt, clue state, route state, or emotional footing.

**Purpose:** Prevent status quo restoration and removable units.

**Pass condition:** After the unit, someone knows, wants, risks, owes, fears, controls, has lost, or can do something different.

**Fail condition:** The unit can be removed without changing future choices, relationships, knowledge, pressure, or character state.

**Enforcement owner:** StoryArchitect, SceneWriter, ChoiceAuthor, CharacterArcTracker, callback validators, branch validators, DramaticStructureValidator, SceneTurnContractValidator.

**Player-agency interaction:** Reconvergence is allowed, but emotional and causal reset is not. Player choices should survive reconvergence through residue.

**Status:** Hard validator for residue fields; prompt guidance for prose and downstream callback expression.

## Character Architecture

Character Architecture clarified how plot pressure should work on the protagonist and important supporting characters.

### Core Rule

The protagonist has a false or protective belief that the season pressures until it becomes unsustainable or is tragically recommitted to.

### Final Concepts

| Concept | Meaning | Status |
|---|---|---|
| `lie` | A false/protective belief or identity distortion. | Agent-facing architecture field. |
| `originPressure` | Broader replacement for mandatory "wound"; may be a past event, pressure, loss, success, humiliation, betrayal, deprivation, vow, social condition, or survival adaptation. | Agent-facing architecture field. |
| `truth` | What the protagonist must recognize, integrate, or refuse. | Agent-facing architecture field. |
| `want` | Conscious goal. | Agent-facing architecture field. |
| `need` | Deeper growth requirement or avoided truth. | Agent-facing architecture field. |
| `climaxChoice` | The active choice that resolves the arc by integrating Truth or recommitting to Lie. | Hard architectural expectation. |
| Supporting micro-Lies | Scaled false beliefs or pressure points for core/supporting NPCs. | Prompt guidance and validator warning, not mandatory for every minor NPC. |

### Non-Regression Decision

"Wound" was not implemented as mandatory trauma. It became `originPressure` so the system can handle comedy, romance, thriller, social drama, adventure, and non-trauma motivations without flattening characters into one template.

### Player Agency

Character growth resolves through protagonist/player action. External events can pressure the Lie, but they should not answer the character arc by themselves.

## Stakes Architecture

Stakes Architecture added a broader taxonomy around the existing Stakes Triangle.

### Stakes Layers

| Layer | Definition |
|---|---|
| Material | Money, job, possessions, position, resource, access, shelter, tool, status. |
| Relational | Trust, friendship, family bond, romance, mentorship, loyalty, reputation with a person or group. |
| Identity | Who the protagonist becomes if they succeed, fail, compromise, or refuse. |
| Existential | Survival of self, others, home, future, freedom, community, meaning, selfhood, or something irreplaceable. |

### How Stakes Layers And Stakes Triangle Work Together

- Stakes layers answer: **what kind of loss is on the table?**
- Stakes Triangle answers: **what does the player want, what does it cost, and what identity does it express?**

The layers define pressure. The triangle makes that pressure playable.

### Escalation Rules

- Major scenes, encounters, dilemmas, climaxes, and sceneEpisodes should usually carry at least three stakes layers.
- Smaller bridge/rest scenes may carry fewer layers if they create clear consequence, setup, payoff, or emotional residue.
- Do not promote material stakes to existential stakes until the player understands the personal, relational, or identity loss that makes the larger threat matter.
- Stakes should escalate gradually.
- Establish what the protagonist personally stands to lose before expanding the threat to the larger world.
- Within a scene, build a stakes ladder: each beat raises risk, reveals cost, narrows options, shifts leverage, or deepens consequence until the pressure peak. Rest beats can raise dread, clarity, regret, or emotional cost rather than volume.

### Status

Stakes architecture is a hard validator for major scenes and sceneEpisodes, a repair layer for missing blueprint fields, and prompt guidance for smaller scene types.

## Theme Architecture

Theme Architecture made theme playable.

### Final Rules

- Theme must be framed as a question, not a noun.
- Theme must be answerable by protagonist/player choices.
- Each episode should take a specific angle on the theme question.
- Major scenes should press, complicate, set up, or pay off the theme.
- Major choices should let the protagonist/player answer, complicate, refuse, or distort the theme.
- Characters should not state the theme question as thesis dialogue.

### Example

Weak theme:

```text
Family
```

Playable theme question:

```text
What do you owe family when loyalty costs your selfhood?
```

### Key Fields

| Field | Purpose |
|---|---|
| `dramaticAudit.themeQuestion` | Working season theme as a question. |
| `dramaticAudit.themePressure` | How the episode tests the theme through plot pressure. |
| `dramaticAudit.themeAngle` | The specific angle this episode takes. |
| `dramaticAudit.themeChoicePressure` | How protagonist/player choice can answer or distort the theme. |
| `scene.themePressure` | How the scene presses or pays off the theme. |
| `choicePoint.themeAnswer` | How the choice engages the theme. |

### Status

Theme architecture is a hard validator for major blueprint fields, a repair layer when treatment guidance provides enough context, and prompt guidance for prose.

## Scene Architecture

Scene Architecture became the Scene Turn Contract.

### Scene Turn Contract

Every scene should satisfy all four requirements:

1. **Entry intent:** The character enters with intent.
2. **Obstacle:** Something blocks the goal.
3. **Forced decision:** The character must decide, commit, refuse, reveal, sacrifice, trade off, or react irreversibly.
4. **Exit shift:** The character leaves on different emotional, strategic, relational, informational, material, or identity footing.

### Decision Does Not Always Mean Visible Choice

A scene can satisfy the forced-decision rule through:

- a visible player choice
- a commitment
- a refusal
- a revelation
- a sacrifice
- a tradeoff
- an irreversible reaction
- a relationship break
- a public/private disclosure
- a failure that changes what is possible next

### Power Dynamic Shifts

In multi-character scenes, power should shift at least once. "Power" is broad:

- leverage
- trust
- vulnerability
- intimacy
- distance
- status
- information
- threat
- debt
- public/private advantage

This does not force every scene into dominance/submission. A quiet reconciliation scene can shift vulnerability or trust.

### Removability Test

A scene must change at least one narrative consequence category:

- information
- relationship
- identity
- resource/access
- danger
- promise/setup/payoff
- choice consequence
- theme pressure
- stakes
- route state
- emotional footing

If removing the scene changes nothing later, rewrite or cut it.

### Subtext And Length Discipline

Subtext and length discipline were kept as prompt guidance and diagnostics, not brittle validators.

- Direct speech can be valid for confession, vow, ritual, strategy, comedy, catharsis, or confrontation.
- Length should be exactly as long as needed to land the scene turn, decision, consequence, or handoff.

### Status

The Scene Turn Contract is a hard blueprint validator. Subtext and length discipline are prompt guidance and diagnostic checks.

## Episode Architecture

Episode Architecture became Episode Pressure Architecture.

### Final Rules

- Each episode has a central dramatic question.
- The opening creates an Opening Promise.
- Episode movement uses major turns, not mandatory 4-5 TV acts.
- Significant turns should close, alter, or intensify current pressure while opening sharper pressure.
- Episodes need an end-state delta.
- Non-finale episodes need forward pressure.
- Story Circle was explicitly rejected because it competes with the existing seven-point season spine and risks formulaic output.

### Opening Promise

The old "cold open" idea became Opening Promise:

| Mode | Opening Promise Behavior |
|---|---|
| Full episode | The first scene establishes hook, episode promise, active pressure, and optional stakes. |
| sceneEpisode | The first beat or first 1-2 beats carry pressure, desire, threat, question, choice, revelation, or relationship tension. |

### A/B/C Pressure Lanes

| Lane | StoryRPG Meaning |
|---|---|
| A-plot | Required external episode pressure. It intersects the climax, encounter, or major choice. |
| B-plot | Protagonist-facing relationship or identity pressure. It can be a scene, sceneEpisode, underlay inside A-plot scenes, or offscreen NPC pressure surfaced through protagonist-visible signals. |
| C-plot | Future seed: callback, object, rumor, world-pressure hint, tonal counterweight, debt, clue, motif, or future reveal. Usually not its own filler scene. |

### Protagonist Viewpoint Rule

B-plots do not create non-protagonist POV scenes. Since the player plays the protagonist, secondary character stories surface through what the protagonist sees, triggers, learns, interrupts, misreads, or causes.

### Status

Episode Pressure Architecture is hard validator-backed at the blueprint level, with StoryArchitect repair logic for missing audit fields.

## Arc Architecture

Arc Architecture became Arc Pressure Architecture.

### Definition Of An Arc

An arc is a 3-8 episode pressure movement inside the season. It is not a TV act and it does not replace the seven-point season spine.

In sceneEpisode seasons, an arc is a chain of scene-length runtime episodes. The chain carries setup, recontextualization, crisis, finale, and handoff; each sceneEpisode carries only its assigned arc turnout.

### Final Fields

| Field | Meaning |
|---|---|
| `arcQuestion` | The specific dramatic question for this arc. |
| `seasonQuestionRelation` | How the arc question relates to the season question. |
| `identityPressureFacet` | Which facet of the protagonist's Lie/Truth/Need/value conflict this arc pressures. |
| `midpointRecontextualization` | The middle of the arc changes the question being asked, not merely the intensity. |
| `lateArcCrisis` | Apparent failure, irreversible cost, collapse of plan, or highest compromise near the final third. |
| `finaleAnswer` | How the arc question resolves. |
| `handoffPressure` | What pressure carries forward into the next arc unless this is the season finale. |
| `episodeTurnouts` | Per-episode consequence, reversal, discovery, cost, escalation, choice residue, crisis, finale, or handoff. |

### Episode-As-Arc-Turnout

We did not implement literal episode-as-act-break. Instead:

> Each episode ending inside an arc must escalate, reverse, reveal, cost, force a choice, recontextualize, crisis-hit, finale-answer, or hand off pressure.

### Status

Arc Pressure Architecture is validator-backed and passed into StoryArchitect as current-episode guidance. The 3-8 episode target is strict for normal arcs but softer for sceneEpisode chains when the treatment requires a different shape.

## Season Architecture

Season Architecture became Season Promise Architecture.

### Final Rules

- A season has one protagonist-centered dramatic question.
- The question fuses goal, stakes, and character pressure.
- The season has central pressure, not necessarily a Big Bad.
- The pilot/episode 1 establishes premise, player role, dramatic engine, and promise of play.
- The finale should satisfy the season as a complete unit while allowing earned future pressure.

### Central Pressure

Central pressure can be:

- person
- institution
- relationship
- mystery
- environment
- social machine
- internal force
- situation
- curse
- debt
- family structure
- public role
- locked-room condition

It does not have to be a villain.

### Season Promise Fields

| Field | Meaning |
|---|---|
| `seasonDramaticQuestion` | One protagonist-centered question for the season. |
| `centralPressure` | The season-long force that pressures the protagonist's choices and character architecture. |
| `seasonPromise` | What kind of story/play experience the season promises. |
| `playerExperiencePromise` | What the player gets to do and feel repeatedly. |
| `emotionalPromise` | The emotional contract of the season. |
| `variationPlan` | How the season delivers fresh variations without betraying the premise. |
| `seasonCompleteness` | How the season resolves enough to stand as a complete unit. |

### Rejected TV-Specific Rules

These were not adopted as hard rules:

- hard re-pilot rule
- fixed tent-pole episode positions
- mandatory penultimate biggest event
- mandatory Big Bad as a person
- fixed TV act formulas

The existing seven-point spine and StoryRPG episode/arc pressure architecture already cover the structural need without forcing stale formulas.

### Status

Season Promise Architecture is validator-backed and prompt-supported. Some multi-season escalation guidance remains deferred/future guidance.

## Information Management

Information Management turned knowledge into a planned story resource.

### Three States Of Information

For every key piece of information, decide whether it is:

1. shared with player/audience
2. withheld from player/audience
3. selectively shared with some characters

### Default Tension Mode

Default to suspense and dramatic irony where possible: the player knows enough to feel pressure, anticipate consequences, or dread a collision.

Mystery is allowed, but it has a shorter shelf life and must be planned.

### Mystery Cap

Hard cap:

```text
Maximum 3 major mystery / box questions per season.
```

This prevents mystery-box collapse and protects answer planning.

### Plant Runway

Important payoffs need runway:

| Mode | Required Runway |
|---|---|
| sceneEpisodes | 5-8 sceneEpisodes ahead |
| Regular episodes | 3-4 episodes ahead |

Very short seasons may need exceptions, but the validator should still warn when payoff runway is too compressed.

### Third Time Pays

Reference a plant at least twice before paying it off when the payoff is important:

1. first reference plants it
2. second reference patterns it
3. third use pays it off

### Net Closure

Each season should close more questions than it opens on net. Future pressure is allowed; unmanaged question debt is not.

### Status

Information Management is hard validator-backed through `InformationLedgerValidator`, with prompt guidance in treatment templates and StoryArchitect dramatic audit fields.

## Failure Mode Diagnostics

Narrative Failure Mode Diagnostics provide shared language for story failures without duplicating all validators.

| Failure Mode | Meaning | Preferred Fix |
|---|---|---|
| Escalation trap | Stakes rise faster than audience/player investment can carry. | Slow down and build personal, relational, or identity investment first. |
| Mystery box collapse | Questions pile up without answer architecture. | Plan answers before introducing new major mysteries. |
| Character drift | Character behavior changes without earned pressure or transition. | Tie action to established psychology, new information, or visible change. |
| Shaggy dog | Long setup receives insufficient payoff. | Pay off proportionally or reduce setup weight. |
| Passive protagonist | Plot happens to the protagonist more than the protagonist causes or reshapes it. | Re-anchor major turns in player/protagonist action. |
| Reset disease | Episodes restore status quo. | Add residue, end-state delta, changed leverage, or relationship/identity movement. |
| Theme drift | Episodes do not press the season's theme question. | Reconnect conflict, choice, cost, or relationship pressure to the theme. |
| Unmotivated escalation | Stakes rise because the writer wants intensity, not because situation demands it. | Anchor escalation in character choice, consequence, or revealed cost. |
| Snowglobe arcs | Arc ending restores arc beginning. | Ensure permanent change or irreversible knowledge/cost. |
| Inverted thematic rhyme | A/B pressure lanes do not relate. | Make B pressure echo, invert, complicate, or personalize A pressure. |
| Convenient coincidence | Solutions arrive from outside protagonist/player choices. | Rewrite so protagonist action produces or enables resolution. |
| Telegraphed twist | Setup is so obvious the twist becomes predictable. | Reduce setup density and redirect expectation. |
| Cheating twist | Twist has no setup. | Plant evidence, motive, capability, pressure, or misread clue earlier. |

### Status

Failure modes are diagnostic warnings and repair feedback. They should route authors and agents toward the right existing validator or repair layer rather than becoming duplicate hard checks.

## Full Episodes vs sceneEpisodes Impact Matrix

### Affects Both Full Episodes And sceneEpisodes

| Change | Full Episode Impact | sceneEpisode Impact |
|---|---|---|
| Treatment parsing | Preserves authored episode titles, guidance, structural roles, dependencies, and resolved endings. | Same, plus maps authored sceneEpisodes into one-scene runtime units. |
| Treatment fidelity | Requires authored anchors, ending pressure, major choice pressure, locations, and consequence seeds to survive. | Same, with less room to hide omissions because each unit is compact. |
| Dramatic audit | Requires stronger episode question, theme pressure, opening promise, turns, end-state delta, and next pressure. | Same, but the single scene must carry both scene and episode audit responsibilities. |
| Theme pressure | Converts vague theme into playable pressure and choice-answerable theme movement. | Same, with greater emphasis on one protagonist/player action. |
| Information plan | Requires item, knownBy, revealTiming, and payoff for major information items. | Same, but each sceneEpisode should usually do one clean information job. |
| Stakes architecture | Requires personal stakes and layered stakes for major scenes. | Same, with special protection against premature existential stakes. |
| Scene transition metadata | `leadsTo` needs `transitionOut` with "therefore" or "but", causal link, and pressure change. | Same when routed targets exist; less frequent in one-scene units. |
| Scene Turn Contract | Scenes need intent, obstacle, forced decision/reaction, and exit shift. | Same, but stricter in practice because the one scene is the whole episode. |
| Failure reporting | Episode failures are surfaced as specific per-episode errors. | Same, producing clearer sceneEpisode generation failures. |

### sceneEpisode-Specific Or Mostly sceneEpisode Changes

| Change | Full Episode Impact | sceneEpisode Impact |
|---|---|---|
| One-scene blueprint contract | No direct impact. | Blueprint must contain exactly one scene unless configuration says otherwise. |
| Scene-length beat repair | No direct impact. | Normal sceneEpisodes are repaired to 6-10 beats. |
| Beat compaction | No direct impact. | Overlong sceneEpisodes are compacted while preserving first/final/choice beats and key pressure. |
| Visible choice fallback | No direct impact from this repair path. | If ChoiceAuthor misses a required choice, the pipeline can create a deterministic fallback from authored option hints. |
| First-beat Opening Promise | Full episodes may still use a first scene. | sceneEpisodes carry Opening Promise in first beat or first 1-2 beats. |
| Branchlet exemption from `nextSceneId` | Full episodes still need routed branching when scene-graph branching is planned. | sceneEpisodes may use route flags, residue, or future pressure without immediate `nextSceneId` routing. |
| Milestone encounter cadence override | No direct impact. | Explicit `routeMeta.isMilestoneEncounter` overrides automatic cadence. |
| Self-route cleanup | Helpful but less common. | Critical for avoiding `scene-1` requiring or leading to itself. |
| Information runway | Regular episodes use 3-4 episode runway. | sceneEpisodes use 5-8 sceneEpisode runway. |
| B-plot shape | Can be protagonist-facing scenes. | Can be dedicated sceneEpisodes, underlays, or offscreen pressure surfaced through protagonist-visible signals. |

### Full-Episode-Specific Impact

Full episodes were affected less by mechanical sceneEpisode repair and more by the editorial-contract upgrades.

Main full-episode impacts:

- stronger theme/stakes/transition/choice enforcement
- clearer A/B/C pressure-lane architecture
- multi-scene `transitionOut` causality
- fuller episode-level `dramaticAudit`
- treatment-authored major choices becoming real `choicePoint`s
- stronger end-state delta and next-episode pressure
- better protection against removable scenes and flat transitions

Full episodes are not subject to the sceneEpisode-specific 6-10 beat repair, one-scene blueprint contract, or sceneEpisode branchlet exemption.

## Main Pipeline Changes Since sceneEpisodes Began

The sceneEpisode work made the main story pipeline more explicit about treatment ingestion, compact episode structure, branch residue, and recoverable LLM omissions.

### Treatment Parsing And Source-Analysis Refresh

FullStoryPipeline now re-parses StoryRPG treatment markdown when the input source looks like a treatment. The refreshed analysis can rebuild episode breakdowns from authored treatment headings, preserve season guidance, carry resolved endings, and avoid stale generic adaptation behavior.

**Problem addressed:** source looked like a StoryRPG treatment but no episode guidance could be parsed.

**Status:** Pipeline behavior and repair layer.

### Season-Plan Refresh From Treatment Documents

The pipeline can align stale `SeasonPlan` episodes with refreshed source analysis. This preserves treatment guidance, structural roles, one-scene sceneEpisode counts, route metadata, and dependency hints.

**Problem addressed:** wrong episode count, stale treatment slice, or sceneEpisode headings not propagating to generation.

**Status:** Pipeline behavior and repair layer.

### sceneEpisode Playable-Contract Repair

The pipeline now repairs normal sceneEpisodes before micro-episode validation:

- pads underfilled beat lists to minimum count
- compacts overlong beat lists to maximum count
- ensures a visible choice point when required
- creates deterministic fallback choice sets from authored option hints
- relinks beat flow after repair

**Problem addressed:** sceneEpisodes failing for 4-5 beats, missing visible choice, or overlong beat output.

**Status:** sceneEpisode-specific repair layer.

### Beat Padding And Compaction

Underfilled sceneEpisodes get synthetic beats that preserve authored dramatic pressure. Overfilled sceneEpisodes are compacted while preserving important beats.

**Status:** sceneEpisode-specific repair layer.

### Fallback Visible Choice Generation

When the blueprint requires a visible choice and ChoiceAuthor fails to produce one, the pipeline can create a fallback `ChoiceSet` using authored `choicePoint.optionHints`.

**Status:** sceneEpisode-specific repair layer for recoverable omissions.

### Scene Graph And Dependency Cleanup

The pipeline and StoryArchitect now clean up self-routing and invalid branch assumptions:

- remove self `leadsTo`
- remove self `requires`
- ignore self dependencies in dependency graph
- disable branch flags when fewer than two valid future targets remain
- allow sceneEpisode route-flag branchlets without immediate `nextSceneId`

**Problems addressed:** unresolved prerequisites like `scene-1`, self-loop sceneEpisodes, and branch validation failures for route flags.

**Status:** Hard validator plus repair layer.

### Treatment Fidelity Preservation

Treatment fidelity now checks deeper runtime story text, including nested encounter/storylet structures, and avoids requiring future whole-treatment anchors in partial sceneEpisode slices.

The pipeline preserves important blueprint pressure outside reader-facing prose if generated story text omits it. These pressure notes belong in agent-facing metadata, choice structures, continuity notes, residue, or validator-readable fields, never as literal story text.

- `Pressure:`
- `Choice pressure:`
- `Forward pressure:`

**Problems addressed:** final story treatment fidelity failures, omitted ending pressure, missing authored choice pressure, and missing residue from alternate paths.

**Status:** Hard validator plus repair layer.

### StoryArchitect Repair Layers

StoryArchitect now repairs or normalizes:

- `dramaticAudit.themePressure`
- `dramaticAudit.themeAngle`
- `dramaticAudit.themeChoicePressure`
- `dramaticAudit.openingPromise`
- `dramaticAudit.informationPlan`
- authored major choice pressure
- forward pressure
- expected residue
- scene transitions
- scene turn contracts
- premature existential stakes
- A/B/C pressure-lane metadata
- bottleneck references
- self `requires` / self `leadsTo`

**Status:** Repair layer. The purpose is to satisfy strict validators when LLM output is close but incomplete, not to weaken the standard.

### Better Episode Failure Reporting And Checkpoint Behavior

Parallel episode generation now reports failures explicitly:

- collects failed episode results
- emits clearer "N of M episodes failed" errors
- writes `99-pipeline-errors.json`
- preserves output directory context

This makes failures actionable instead of collapsing into a vague final pipeline failure.

**Status:** Pipeline behavior.

### Tests Added And Focused Verification

Focused test coverage was added or updated around:

- StoryArchitect editorial repair
- TreatmentFidelityValidator
- SceneGraphBranchValidator
- dependency graph self-reference handling
- FullStoryPipeline sceneEpisode repair
- MicroEpisodeSeasonValidator

Recent focused checks and typecheck were passing before this report was requested. A full validation run is not required for this docs-only report.

## Implementation Map

This is a high-level map, not a file-by-file changelog.

### Documentation

| File | Role |
|---|---|
| [`docs/STORY_STRUCTURE_RULES_ASSESSMENT.md`](STORY_STRUCTURE_RULES_ASSESSMENT.md) | Source assessment and implementation notes for P1-P8, stakes, theme, character, scene, episode, arc, season, information, and failure modes. |
| [`docs/STORY_QUALITY_CONTRACT.md`](STORY_QUALITY_CONTRACT.md) | Active quality contract for agency, choice stakes, consequence budget, convergent spine, delayed memory, fiction-first mechanics, mechanical storytelling, setup/payoff, and validators. |
| [`docs/STORY_TREATMENT_REGULAR_EPISODE_PROMPT.md`](STORY_TREATMENT_REGULAR_EPISODE_PROMPT.md) | Treatment prompt for regular multi-scene episodes. |
| [`docs/STORY_TREATMENT_SCENEEPISODE_PROMPT.md`](STORY_TREATMENT_SCENEEPISODE_PROMPT.md) | Treatment prompt for sceneEpisode seasons and compact sceneEpisode structure. |
| [`docs/CURRENT_PIPELINE_STATUS.md`](CURRENT_PIPELINE_STATUS.md) | Current pipeline behavior and compatibility status. |
| [`docs/STORY_PIPELINE_PROMPTING.md`](STORY_PIPELINE_PROMPTING.md) | Prompting contracts and downstream agent guidance. |

### Pipeline And Agent Files

| File | Role |
|---|---|
| [`storyrpg-prototype/src/ai-agents/pipeline/FullStoryPipeline.ts`](../storyrpg-prototype/src/ai-agents/pipeline/FullStoryPipeline.ts) | Main orchestration, treatment refresh, sceneEpisode repair, fidelity enforcement, branch/dependency cleanup, failure reporting. |
| [`storyrpg-prototype/src/ai-agents/agents/StoryArchitect.ts`](../storyrpg-prototype/src/ai-agents/agents/StoryArchitect.ts) | Blueprint generation, P1-P8 audit fields, dramatic repair layers, scene turn contract repair, treatment pressure preservation. |
| [`storyrpg-prototype/src/ai-agents/agents/SceneWriter.ts`](../storyrpg-prototype/src/ai-agents/agents/SceneWriter.ts) | Beat generation, sceneEpisode beat-count pressure, final beat handoff. |

### Validators

| Validator | Role |
|---|---|
| `DramaticStructureValidator` | P1-P8 dramatic audit, stakes, residue, transition checks. |
| `ThemePressureValidator` | Theme as playable question, choice-answerable theme pressure, anti-thesis-dialogue checks. |
| `SceneTurnContractValidator` | Entry intent, obstacle, forced decision/reaction, exit shift, power shift, removability. |
| `EpisodePressureArchitectureValidator` | Episode question, opening promise, A/B/C pressure lanes, end-state delta, next pressure. |
| `ArcPressureArchitectureValidator` | Arc question, midpoint recontextualization, late crisis, finale answer, handoff pressure, episode turnouts. |
| `SeasonPromiseValidator` | Season dramatic question, central pressure, promise of play, completeness. |
| `InformationLedgerValidator` | Mystery cap, information ownership, reveal/payoff timing, plant runway, net closure. |
| `TreatmentFidelityValidator` | Authored treatment pressure, anchors, choices, endings, and partial-slice fidelity. |
| `SceneGraphBranchValidator` | Branch route validity, branch residue, lost branch detection, sceneEpisode branchlet handling. |
| `MicroEpisodeSeasonValidator` | sceneEpisode season cadence, milestone encounters, beat/choice expectations. |
| `NarrativeFailureModeValidator` | Shared diagnostic vocabulary for common story failures. |

## Public Interfaces And Story Fields

This report introduces no new runtime API. It documents story architecture concepts that exist in prompts, validators, types, or current working-tree changes.

### Important Fields

| Field / Concept | Purpose |
|---|---|
| `dramaticAudit` | Episode-level audit for question, theme, opening promise, pressure lanes, end-state delta, turns, stakes, and information plan. |
| `dramaticStructure` | Scene-level question, turn, pressure peak, and changed state. |
| `personalStake` | Concrete personal cost or value at risk. |
| `stakesLayers` | Material, relational, identity, and/or existential stakes. |
| `transitionOut` | Causal handoff from one scene to reachable next scenes using "therefore" or "but". |
| `residue` | What remains changed after the scene or choice. |
| `characterArchitecture` | Lie, originPressure, Truth, Want, Need, climax choice, and supporting micro-arcs. |
| `seasonPromiseArchitecture` | Season dramatic question, central pressure, promises, variation, and completeness. |
| Arc pressure fields | Arc question, relation to season question, identity facet, midpoint, late crisis, finale answer, handoff, episode turnouts. |
| Information ledger fields | Item, knowledge owner, reveal timing, payoff, setup/runway, mystery status. |
| sceneEpisode route metadata | Master-spine role, milestone encounter marker, cadence exceptions, route/branchlet intent. |

### Status Categories

| Status | Meaning |
|---|---|
| Hard validator | Failure should block or retry generation unless explicitly configured otherwise. |
| Repair layer | Deterministic code fixes recoverable LLM omissions without lowering the target. |
| Prompt guidance | Agent-facing instruction that shapes output but may not be independently validated. |
| Diagnostic warning | Non-blocking story-quality signal for review or repair feedback. |
| Deferred/future guidance | Useful principle intentionally not implemented as current validation. |

## Non-Regression Principles

These principles govern future changes to this rule stack.

1. **Do not weaken validators to pass bad output.** Tighten prompts, repairs, or data flow first.
2. **Do not replace the seven-point season spine.** Arc, episode, scene, and sceneEpisode structures reinforce it.
3. **Do not expose raw mechanics to the player.** Stats, thresholds, dice, and numerical mechanics stay fiction-first.
4. **Do not force TV formulas when StoryRPG structure already covers the need.** Avoid rigid re-pilots, mandatory 4-5 acts, fixed tent-poles, and mandatory penultimate climax.
5. **Preserve player agency and branching residue.** Reconvergence is acceptable; erased choice is not.
6. **Prefer deterministic repair for recoverable LLM omissions.** Repair missing fields, self-routes, incomplete information items, and underfilled sceneEpisodes when the intended structure is clear.
7. **Keep sceneEpisodes compact but not shallow.** A sceneEpisode is one strong dramatic scene that also functions as a runtime episode.
8. **Keep 60% protagonist causality as an audit target, not brittle math.** The goal is causal ownership.
9. **Keep subtext and length discipline as craft guidance.** Do not block valid direct speech or quiet scenes when they still create residue.
10. **Keep B-plots protagonist-facing.** No non-protagonist POV cutaways in playable StoryRPG episodes.

## Open Risks And Follow-Ups

### Risk: StoryArchitect Repair Overcorrection

Some StoryArchitect repair logic applies to both full episodes and sceneEpisodes. This is useful for enforcing editorial standards, but regular full episodes should be watched for overcorrection: too many forced audit phrases, overly uniform scene turns, or excessive pressure where a rest/aftermath scene should breathe.

**Follow-up:** Continue generating both regular-episode and sceneEpisode treatments and compare failure patterns.

### Risk: 60% Causality Becoming Brittle

The 60% protagonist/player causality target is editorially useful but semantically difficult to compute.

**Follow-up:** Keep it as a planning audit and failure-mode diagnostic. Do not convert it into exact hard math.

### Risk: Subtext And Length Discipline As Hard Gates

Subtext and concise scene length are good craft principles, but hard validation would create false failures.

**Follow-up:** Keep these as prompt guidance, SceneCritic-style diagnostics, or post-generation review notes.

### Risk: Mystery Cap Too Strict For Some Genres

The hard cap of three major mysteries per season protects against mystery-box collapse, but some genres depend on layered open questions.

**Follow-up:** Treat the cap as applying to major box questions, not every clue, suspicion, rumor, or tactical unknown.

### Risk: sceneEpisodes Becoming Mechanically Valid But Thin

The repair layer can ensure 6-10 beats and a visible choice, but that alone does not guarantee a great sceneEpisode.

**Follow-up:** Keep validating entry intent, obstacle, forced decision, exit shift, stakes layers, theme pressure, information job, and residue.

### Risk: Full Episodes And sceneEpisodes Drifting Apart

Full episodes and sceneEpisodes should share the same story philosophy while using different runtime shapes.

**Follow-up:** Preserve shared editorial contracts, but keep mode-specific mechanics isolated: beat repair, one-scene requirement, first-beat Opening Promise, and branchlet `nextSceneId` exception.

## Quick Reference

### The StoryRPG Rule Stack

```text
Season seven-point spine
  -> Season Promise Architecture
  -> Arc Pressure Architecture
  -> Episode Pressure Architecture
  -> Scene Turn Contract
  -> Choice architecture and Stakes Triangle
  -> Consequence, residue, callbacks, and payoff
```

### The sceneEpisode Shape

```text
One playable scene
  -> entry intent
  -> active obstacle
  -> pressure ladder
  -> forced decision or irreversible reaction
  -> exit shift
  -> residue that makes the next sceneEpisode necessary
```

### The Full-Episode Shape

```text
Opening Promise
  -> major turns
  -> A/B/C pressure lanes
  -> scene-level turns
  -> climax / encounter / major choice
  -> episode end-state delta
  -> next episode pressure
```

### The Non-Regression Test

Before accepting any new story rule, ask:

1. Does it preserve player agency?
2. Does it preserve fiction-first mechanics?
3. Does it reinforce, rather than replace, the seven-point spine?
4. Does it create clearer editorial decisions without forcing stale formulas?
5. Does it leave residue after reconvergence?
6. Does it help both regular episodes and sceneEpisodes, or is it cleanly mode-specific?

If the answer is no, the rule should be modified, softened into guidance, or ignored.
