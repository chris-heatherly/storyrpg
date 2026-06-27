# Story Treatment MVP Prompt Guide

**Purpose:** A streamlined guide for prompting an LLM to create a choose-your-own-adventure / branching narrative story treatment that gives the current StoryRPG generator the right raw material: character briefs, a Story Circle season spine, episode role assignments, arc pressure, scene-first episode turns, encounter targets, meaningful choices, alternate consequence-bearing paths, exactly 3 alternate season endings, and the storytelling rules that make those inputs useful downstream.

Use this when you are not asking the model to generate the full playable story. The goal is a compact, high-signal treatment for a branching interactive season: clear anchors, Story Circle beat realization, purposeful expansions, character pressure, arc pressure, encounter-first planning, forward-pressure endings, choice pressure, alternative paths, consequence opportunities, and style-safe visual specificity.

## StoryRPG Structure Model

StoryRPG uses this hierarchy:

```text
Season
  Acts
    Story Circle spine
      Arcs
      Episodes
        Episode turns
          Scenes
            Beats
```

Each layer has a different job:

| Layer | Purpose |
|---|---|
| Season | The complete story arc and identity transformation. |
| Act | A broad dramatic phase. Acts organize pressure; they do not replace the Story Circle. |
| Story Circle beat | A required season-level structural turn: `you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`. |
| Arc | A contiguous pressure movement inside the season Story Circle. |
| Episode | A playable installment that carries one Story Circle beat, fused adjacent beats, or an expansion of a beat. |
| Episode turn | A major planning movement inside an episode that changes pressure, leverage, information, relationship, identity, or consequence. |
| Scene | A dramatic situation generated later by the pipeline. |
| Beat | The smallest visible story turn generated later by the pipeline. |

Do not give every episode its own separate Story Circle. The Story Circle is the **season spine**, and episodes realize slices of it through scene turns, choices, encounters, and endings.

Episodes may carry:

- one named Story Circle beat, such as `find`
- fused adjacent beats in a short season, such as `you + need` or `return + change`
- a contiguous expansion of a beat in a longer season, such as `search expansion` or `take expansion`

Expansions are not filler. They should escalate pressure, process consequences, develop relationships, create or pay off callbacks, prepare the next Story Circle beat, or open a fiction-first path to growth, recovery, alliance, investigation, alternate leverage, or a harder route.

## What The Treatment Must Do

A good treatment gives the generator enough intent to produce authored-feeling interactive fiction:

- A clear protagonist goal, wound, pressure, and possible transformation.
- A small cast with distinct desires, secrets, leverage, and relationships.
- A season spine built around the 8-beat Story Circle structure.
- An episode map where every episode has a Story Circle beat, fused-beat, or expansion role.
- An arc plan where every arc has a question, identity pressure facet, midpoint/reframe or late crisis when appropriate, finale answer, handoff pressure, and episode turnouts.
- Episode turns: 3-6 major movements inside each episode.
- Encounter-first episodes where the encounter manifests the episode's central conflict and targets `go`, `search`, `find`, or `take`.
- Meaningful choose-your-own-adventure choices that are about identity under pressure, not optimization.
- Alternative paths where player choice has consequence.
- Branches that are finite, meaningful, and reconvergent.
- Exactly 3 alternate endings per season.
- Enough story-specific visual detail for images and scenes to stay coherent without overriding the active art style.

## MVP Inputs

Ask the treatment LLM to produce these sections and keep them concise.

### 1. Story Premise

Minimum fields:

- **Title**
- **Genre**
- **Tone**
- **Logline:** one sentence.
- **Core fantasy:** what the player gets to feel or do.
- **Themes:** 3-5.
- **Audience promise:** the emotional experience the season should deliver.

Useful rule: the premise should imply pressure. Avoid static vibes like "a haunted city full of secrets" unless the treatment also says what the protagonist must do there and what happens if they fail.

### 2. Season Anchors

These map directly to the pipeline's most important planning concepts.

- **Stakes:** who or what the protagonist most cares about losing.
- **Goal:** what the protagonist is actively trying to achieve.
- **Inciting incident:** the event that makes inaction impossible.
- **Climax:** the final confrontation or irreversible test.

The generator performs better when these are concrete. "Save the kingdom" is weaker than "prove the queen's heir is a fraud before the coronation bell finishes ringing."

### 3. Story Circle Season Spine

Provide one season-level beat for each:

- **You:** the protagonist's ordinary world, identity posture, routine, protection strategy, and opening promise.
- **Need:** the missing truth, pressure, contradiction, wound, or external lack that makes the current identity insufficient.
- **Go:** the threshold crossing. The protagonist commits, is forced out, or enters the unfamiliar pressure field.
- **Search:** experiments, investigation, pursuit, adaptation, alliance, temptation, and increasing cost.
- **Find:** the midpoint discovery, reversal, false victory, or truth that changes the meaning of the goal.
- **Take:** the real price. The protagonist loses something, pays for the new knowledge, or faces the consequence of the old strategy.
- **Return:** the return toward the original world, final confrontation, reckoning, or attempt to bring the answer home.
- **Change:** the changed self/world, thematic answer, aftermath, or refusal of transformation.

Add an episode anchor to each beat when you know it, using `(EpN)` on the same line so the pipeline can bind authored Story Circle obligations to episode targets.

```text
You (Ep1): ...
Need (Ep2): ...
Go (Ep3): ...
Search (Ep4): ...
Find (Ep6): ...
Take (Ep8): ...
Return (Ep10): ...
Change (Ep10): ...
```

Also provide an act mapping. Acts are organizational pressure bands; Story Circle remains the structural authority.

```text
Act 1: Setup / Disruption
  You
  Need
  Go

Act 2: Escalation / Transformation
  Search
  Find
  Take

Act 3: Confrontation / Aftermath
  Return
  Change
```

Each episode should be assigned a Story Circle role:

- **Standard 8-episode shape:** one primary beat per episode.
- **Fewer than 8 episodes:** fuse adjacent beats only; do not skip beats.
- **More than 8 episodes:** keep the eight primary beats in order and mark extras as contiguous expansions of the beat they deepen.

Legacy seven-point labels can be included only as optional crosswalk notes when useful for adaptation, but new treatments should not use them as the primary structure.

### 4. Protagonist Brief

Minimum fields:

- **Name and pronouns**
- **Role in the world**
- **Want:** the conscious external goal.
- **Need:** what they need to recognize, accept, change, or refuse.
- **Lie:** the false belief or survival posture that protects and limits them.
- **Wound or origin pressure:** the past event, system, relationship, or pattern that made the Lie useful.
- **Truth:** what growth would require them to recognize, or what they refuse in a tragic/corruption arc.
- **Arc mode:** positive, tragic, corruption, disillusionment, recovery, or ambiguous.
- **Climax choice:** the active choice that integrates the Truth or recommits to the Lie.
- **Starting identity:** how they tend to solve problems at the beginning.
- **Possible end states:** 2-4 ways they can become different depending on choices.
- **Pressure points:** relationships, fears, loyalties, temptations, or secrets that choices can test.
- **Visual identity:** silhouette, clothing, age read, physical markers, emotional bearing.

Rule: the protagonist should not be generically capable. Give them a strength that causes problems and a weakness that sometimes helps.

The treatment may describe internal wound or contradiction as planning material, but generated scenes should externalize emotion through action, dialogue, silence, body language, facial expression, object handling, proximity, avoidance, and choice behavior rather than direct internal monologue.

### 5. NPC Briefs

For each major NPC:

- **Name**
- **Role:** ally, antagonist, rival, mentor, love interest, wildcard, or neutral.
- **Want:** what they actively pursue.
- **Leverage:** what they can give, block, expose, or take away.
- **Secret or contradiction**
- **Relationship to protagonist**
- **How player choices can change the relationship**
- **Voice notes:** cadence, attitude, recurring verbal habits.
- **Visual identity:** distinct silhouette, costume, physical marker, or mannerism.

MVP cast size: 3-6 major NPCs. More than that tends to dilute early episodes unless the story needs an ensemble.

### 6. World And Location Brief

Minimum fields:

- **World premise**
- **Time period**
- **Technology/magic/supernatural rules, if any**
- **Power structures:** factions, institutions, families, crews, faiths, corporations, etc.
- **Rules that create drama:** what is forbidden, scarce, dangerous, sacred, or socially costly.
- **3-6 key locations:** each with purpose, mood, history, and likely choice pressure.

Rule: worldbuilding should create choices. A detail is useful if it gives the protagonist leverage, danger, temptation, identity pressure, or a later callback.

### 7. Episode Outline

For each episode:

- **Episode number and title**
- **Act:** Act 1, Act 2A, Act 2B, or Act 3.
- **Story Circle role:** one primary beat, fused adjacent beats, or expansion role. Use exact beat names: `you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`.
- **Role note:** why this episode owns that beat or expansion, and why it cannot move earlier/later without weakening causality.
- **Episode promise:** what dramatic question this episode answers.
- **Episode turns:** 3-6 major movements inside the episode.
- **Synopsis:** 2-4 sentences.
- **Opening situation**
- **Cold open function:** the first strong image, disruption, question, or pressure hook that makes the episode immediately playable.
- **Encounter anchor:** the central confrontation, negotiation, chase, investigation, heist, survival test, puzzle, social rupture, romantic vulnerability, public exposure, betrayal, or impossible choice.
- **Encounter Story Circle target:** one of `go`, `search`, `find`, or `take`. Encounters do not directly target `you`, `need`, `return`, or `change`; those beats frame the episode while the playable encounter realizes pressure.
- **Encounter target rationale:** why the encounter is a threshold/crossing (`go`), active pursuit/adaptation (`search`), discovery/reversal (`find`), or real cost/payment (`take`).
- **How the encounter manifests the central conflict**
- **Encounter buildup:** what earlier scenes establish so the encounter choices feel loaded.
- **Aftermath / consequence:** what the encounter changes.
- **Major choice pressure:** 2-4 meaningful choices the episode should invite.
- **Alternative paths:** where choices can send the player, what changes, and where paths reconverge.
- **Consequence seeds:** flags, relationships, secrets, wounds, debts, clues, damaged trust, reputation loss, identity pressure, resource loss, or altered ending eligibility.
- **Ending pressure:** for non-finale episodes, the final turn into the next episode.
- **Resolution / aftermath:** for finale episodes, what changed and what the protagonist's future or legacy looks like.

Episode rule: each episode should feel like the reason it exists is the encounter. The scenes before it load the emotional, informational, relational, and mechanical ammunition; the scenes after it show the cost.

Episode planning should assume each generated episode will become **3-6 scenes**.

Each episode should have **3-6 episode turns**. These are planning movements, not a new runtime schema.

Normal generated scenes should target **3-8 beats**, but the treatment does not need to write those beats.

If the treatment suggests scene-level material, each scene should:

- have a felt purpose
- have an entry goal, obstacle, forced choice or turn, and exit shift
- build toward a key moment
- include externalized emotion through action, dialogue, body language, silence, or object behavior
- end with consequence, resolution, or forward pressure

### 8. Arc Plan

For each arc:

- **Arc title and episode range**
- **Story Circle span:** start beat, end beat, and owned beats.
- **Arc dramatic question:** the question this pressure movement answers or complicates.
- **Relation to season question:** how it advances the larger transformation.
- **Identity pressure facet:** which part of the protagonist's Lie/Need/Truth it tests.
- **Midpoint recontextualization, if the arc contains `find`:** what the protagonist understands differently.
- **Late arc crisis, if the arc contains `take`:** the apparent failure or irreversible cost.
- **Finale answer:** what the last episode in the arc proves, resolves, denies, or hands forward.
- **Handoff pressure:** the unresolved pressure that makes the next arc necessary.
- **Episode turnouts:** for each episode in the arc, list the Story Circle beat, turn type, what changes, what the protagonist is left with, and why that episode cannot move later.

Arc rule: an arc is not an act and not a separate story formula. It is a contiguous pressure movement inside the season Story Circle.

### 9. Branching And Consequences

Plan a finite set of branches:

- **2-4 cross-episode branch points** for a season of 3+ episodes.
- Each branch should create a different experience later, then reconverge at a bottleneck.
- Each branch should leave residue after reconvergence: altered dialogue, relationship tone, available help, visual damage, missing information, changed reputation, damaged trust, or changed ending eligibility.
- Prefer callbacks and scene tints for most consequences; use branchlets for major choices; reserve structural branches for climaxes and endings.

Every meaningful choice should affect at least one of:

- **Outcome:** what happens.
- **Process:** how the player gets there.
- **Information:** what the player learns or misses.
- **Relationship:** how someone behaves toward the protagonist.
- **Identity:** what kind of person the protagonist is becoming.
- **Resources or leverage:** what the protagonist gains, spends, loses, exposes, or damages.

### 10. Capability, Growth, And Fail-Forward

Plan challenges so outcomes can reflect skills, attributes, relationships, flags, identity, resources, prior choices, and encounter outcomes.

If the protagonist falls short, failure should open playable story material:

- preparation
- training
- recovery
- mentorship
- alliance
- investigation
- information gathering
- alternate leverage
- a harder route through another relationship or resource

Do not frame growth as grinding, levels, thresholds, or visible stats. Keep it fiction-first.

Failure should create story, not a dead end.

### 11. Episode Endings: Forward Pressure And Resolution

Non-finale episodes need a deliberate ending turn that resolves the immediate episode pressure enough to feel satisfying, then opens a new question, cost, reveal, danger, relationship rupture, choice consequence, or next pressure.

Finale/resolution episodes should not fake unresolved main conflict. They should resolve the season's central conflict and show aftermath, cost, transformation, future, or legacy.

Each non-finale episode ending should do at least one of:

- Reveal new information that changes the player's understanding.
- Force a decision whose consequences begin next episode.
- Recontextualize an ally, enemy, location, or goal.
- Show the cost of the player's prior success.
- Open a new danger while resolving the episode's immediate conflict.
- Damage a relationship, reputation, resource, secret, or identity position.

Avoid fake cliffhangers that simply withhold obvious information. The best episode endings are turns of meaning, not just interruptions.

### 12. Alternate Endings

Every season treatment must define exactly 3 alternate ending targets.

For each ending:

- **Name**
- **Summary**
- **Emotional register:** tragic, bittersweet, triumphant, corrupted, lonely, redemptive, etc.
- **Theme payoff:** what the ending says about the season's central question.
- **State drivers:** the relationship, identity pattern, flag, encounter outcome, faction alignment, or choice pattern that leads there.
- **Target conditions:** plain-language eligibility rules.

Rule: endings should pay off repeated choices, not one arbitrary final selection. The three endings should be meaningfully different emotional and thematic destinations, not simple success/neutral/failure reskins.

## Storytelling Rules For The Treatment LLM

Use these rules while creating the treatment:

- **Fiction first:** never design around visible stats, dice, meters, levels, thresholds, or optimization language. Mechanics should appear as fear, leverage, trust, injury, debt, access, temptation, preparation, reputation, information, relationship state, or resource pressure.
- **Choose-your-own-adventure form:** design for branching narrative play, where the player reads, chooses, experiences consequences, and sees alternate paths converge into later Story Circle beats.
- **Want + cost + identity:** every important choice needs a clear desire, a real price, and a self-defining implication.
- **Pressure reveals character:** choices should ask "who are you under pressure?" more often than "which option is correct?"
- **Branch and bottleneck:** create real divergence, then reconverge at planned Story Circle beats without erasing the player's path.
- **Delayed memory:** important decisions should return later through callbacks, altered relationships, scene tints, changed information, visual damage, reputation change, or ending eligibility.
- **Encounter-first episodes:** each episode needs a dramatic center that tests the episode's relationships, secrets, skills, resources, and theme.
- **Encounter as central conflict:** the encounter should manifest the episode's core conflict, not sit beside it as a random event.
- **Encounter targets:** planned encounters should target `go`, `search`, `find`, or `take` and explain why. Do not label a playable encounter as `you`, `need`, `return`, or `change`.
- **Story Circle realization:** every authored Story Circle beat should become visible as scene pressure and final prose, not only metadata.
- **Setup before payoff:** twists, reversals, rescues, betrayals, and endings need earlier plants.
- **Escalation with variation:** pressure should rise across the season, but episode encounters should vary in kind and emotional texture. Do not require every beat or scene to be more intense than the previous one.
- **Characters want different things:** every major NPC should be able to create friction even when they are helpful.
- **No purely cosmetic drama:** a secret, clue, item, wound, promise, reputation change, resource loss, or relationship shift should matter later if the treatment spotlights it.
- **Conflict costs something:** every meaningful conflict should damage someone or something. Damage can be physical, emotional, social, relational, resource-based, reputational, informational, moral, or identity-based.
- **Action has impact:** fight, weapon, pursuit, survival, or major physical-action scenes should involve serious jeopardy, specific maneuvers, destructive impact, wounds or visible damage, and consequences.
- **Non-action encounters still need pressure:** social, romantic, investigative, moral, or political encounters should still risk trust, reputation, access, secrets, relationships, identity, or resources.
- **Externalize emotion:** do not plan scenes around internal monologue or direct thought/feeling explanation. Emotional content should be expressed through action, dialogue, silence, body language, facial expression, object handling, proximity, avoidance, and choice behavior.
- **Spare subtextual dialogue:** dialogue should reveal character, sharpen pressure, change leverage, or expose relationship dynamics.
- **Dynamic description:** sensory and environmental details should carry mood, danger, intimacy, consequence, or tension. Do not force all five senses.
- **Avoid repetition:** repeated scenes, phrasing, dialogue, and descriptive beats should only appear as intentional callbacks, refrains, contrasts, or payoffs.
- **Style-safe visual specificity:** name what should be seen, not the rendering style. Give concrete story details: character silhouettes, costumes, props, locations, wounds, gestures, spatial relationships, environmental pressure, and key images. Avoid generic art-direction words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, gritty, glossy, or high contrast unless the requested style specifically calls for them.

## Copy-Paste Prompt

```text
You are creating a compact story treatment for StoryRPG, a choose-your-own-adventure / branching narrative generator that turns a treatment into a visual-novel/RPG season.

Your output is not the full story prose. It is the planning document the generator will use to create episodes, scenes, meaningful choices, alternate paths, encounters, images, episode endings, and exactly 3 alternate season endings.

Core structure:
- StoryRPG uses this hierarchy: Season -> Acts -> Story Circle spine -> Arcs -> Episodes -> Episode turns -> Scenes -> Beats.
- The season uses an 8-beat Story Circle spine: you, need, go, search, find, take, return, change.
- Episodes carry one Story Circle beat, fused adjacent beats, or contiguous expansions of a beat.
- For fewer than 8 episodes, fuse adjacent beats only; do not skip beats. For more than 8 episodes, keep the eight primary beats in order and mark extras as expansions.
- Expansions are purposeful: escalation, consequence processing, relationship development, callbacks, preparation, recovery, investigation, alternate leverage, or harder routes.
- Arcs are contiguous pressure movements inside the Story Circle, with questions, identity pressure, turnouts, crisis/reframe where relevant, finale answers, and handoff pressure.
- Each episode should have 3-6 episode turns and should be designed to generate 3-6 scenes.
- Do not give every episode its own separate Story Circle.
- Planned encounters target go, search, find, or take; you, need, return, and change frame episodes but are not direct encounter targets.

Core rules:
- Fiction first: never expose stats, dice, meters, levels, thresholds, or game math.
- This is choose-your-own-adventure branching narrative: player choices must create alternate paths and consequences.
- Every meaningful choice should have WANT, COST, and IDENTITY.
- Choices should affect outcome, process, information, relationship, identity, resource, or leverage.
- Use branch-and-bottleneck structure: real divergence, later reconvergence, persistent residue.
- Each episode should have one encounter anchor that manifests the episode's central conflict.
- Each encounter should name its Story Circle target and rationale.
- Non-finale episodes end with forward pressure. Finale/resolution episodes resolve the central conflict and show aftermath.
- Set up twists before payoff. Let decisions echo later.
- Create exactly 3 alternate season endings. Endings should pay off repeated choice patterns, not one arbitrary final choice.
- Conflict should cost something: physical, emotional, social, relational, resource, reputation, information, moral, or identity damage.
- Fight/action encounters should include serious jeopardy, specific maneuvers, destructive impact, wounds or visible damage, and consequence.
- Character emotion should be externalized through action, dialogue, silence, body language, object handling, proximity, avoidance, and choices. Do not rely on internal monologue.
- Use sensory detail selectively. Do not force all five senses.
- Be visually specific in story terms, not art-direction terms.

Create a treatment with these sections:

1. Story Premise
- Title
- Genre
- Tone
- Logline
- Core fantasy
- Themes
- Audience promise

2. Season Anchors
- Stakes
- Goal
- Inciting incident
- Climax

3. Story Circle Season Spine
For each Story Circle beat, include a concrete season-level event and an episode anchor when known:
- You (EpN): ordinary world, identity posture, protection strategy, and opening promise
- Need (EpN): missing truth, contradiction, wound, or external lack
- Go (EpN): threshold crossing, commitment, exile, or forced entry into unfamiliar pressure
- Search (EpN): experiments, investigation, pursuit, adaptation, alliance, temptation, and increasing cost
- Find (EpN): midpoint discovery, reversal, false victory, or truth that changes the goal
- Take (EpN): the real price, loss, sacrifice, or consequence of the old strategy
- Return (EpN): return toward the original world, final confrontation, reckoning, or bringing the answer home
- Change (EpN): changed self/world, thematic answer, aftermath, or refused transformation
- Act mapping: Act 1 = You/Need/Go, Act 2 = Search/Find/Take, Act 3 = Return/Change
- Optional legacy crosswalk notes only if useful; Story Circle is the primary structure.

4. Protagonist Brief
- Name and pronouns
- Role in the world
- Want
- Need
- Lie
- Wound or origin pressure
- Truth
- Arc mode
- Climax choice
- Starting identity
- Possible end states
- Pressure points
- Visual identity

5. Major NPC Briefs
For each major NPC:
- Name
- Role
- Want
- Leverage
- Secret or contradiction
- Relationship to protagonist
- How player choices can change the relationship
- Voice notes
- Visual identity

6. World And Location Brief
- World premise
- Time period
- Technology/magic/supernatural rules, if any
- Power structures
- Rules that create drama
- 3-6 key locations with purpose, mood, history, and likely choice pressure

7. Episode Outline
For each episode:
- Episode number and title
- Act
- Story Circle role: one primary beat, fused adjacent beats, or expansion role
- Role note: why this episode owns that beat or expansion and why it cannot move earlier/later
- Episode promise
- Episode turns: 3-6 major movements
- Synopsis
- Opening situation
- Cold open function
- Encounter anchor
- Encounter Story Circle target: go, search, find, or take
- Encounter target rationale
- How the encounter manifests the central conflict
- Encounter buildup
- Aftermath / consequence
- Major choice pressure: 2-4 choices the episode should invite
- Alternative paths: where choices can send the player, what changes, and where paths reconverge
- Consequence seeds
- Ending pressure for non-finale episodes, or resolution / aftermath for finale episodes

8. Arc Plan
For each arc:
- Arc title and episode range
- Story Circle span: start beat, end beat, and owned beats
- Arc dramatic question
- Relation to season question
- Identity pressure facet
- Midpoint recontextualization if the arc contains find
- Late arc crisis if the arc contains take
- Finale answer
- Handoff pressure
- Episode turnouts: episode number, Story Circle beat, turn type, what changes, what the protagonist is left with, and why this cannot move later

9. Cross-Episode Branches And Consequence Chains
- 2-4 major branch points if the season has 3+ episodes
- What choice or encounter outcome creates each branch
- How each branch changes a later episode
- Where it reconverges
- What residue remains after reconvergence

10. Capability, Growth, And Fail-Forward
- Key challenges that test skill, relationships, identity, resources, prior choices, or encounter outcomes
- How failure can open preparation, training, recovery, mentorship, alliance, investigation, information gathering, or alternate leverage
- How growth remains fiction-first without visible stats, levels, thresholds, or grind language

11. Episode Endings
- Non-finale ending pressure: question, cost, reveal, danger, relationship rupture, choice consequence, or next pressure
- Finale/resolution aftermath: what changed, what was saved or lost, and what the protagonist's future or legacy looks like

12. Alternate Endings
Provide exactly 3 alternate season ending targets. For each:
- Name
- Summary
- Emotional register
- Theme payoff
- State drivers
- Target conditions

Keep the treatment concise but specific. Prefer concrete nouns, active conflicts, visible details, externalized emotion, consequence-bearing choices, and playable pressures over abstract theme language.
```

## Quick Quality Checklist

Before using a treatment as generator input, check:

- Can you state the protagonist's goal and stakes in one sentence?
- Does every major NPC want something that can complicate the protagonist's goal?
- Are all 8 Story Circle beats covered across the season: `you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`?
- Does each authored Story Circle beat include an `(EpN)` anchor when the target episode is known?
- Does each episode have a Story Circle role: primary beat, fused adjacent beats, or expansion?
- Are expansions doing real story work rather than filler?
- Does each arc have a Story Circle span, dramatic question, identity pressure, episode turnouts, and handoff/finale logic?
- Does every episode have 3-6 episode turns?
- Does each episode have a dramatic encounter anchor?
- Does each encounter name a valid Story Circle target: `go`, `search`, `find`, or `take`?
- Does each episode's encounter manifest the episode's central conflict?
- Does each non-finale episode end with forward pressure rather than fake withholding?
- Does the finale resolve the central conflict and show aftermath?
- Are there 2-4 cross-episode consequences for a multi-episode season?
- Are there exactly 3 alternate season endings?
- Do all alternate endings map to repeated choices or state patterns?
- Does every major conflict cost someone something?
- Are action/fight scenes planned with serious jeopardy, concrete maneuvers, impact, wounds/damage, and consequence?
- Are emotional beats externalized instead of relying on internal monologue?
- Are key characters and locations visually distinct?
- Are visual details story-specific and style-safe?
- Does the treatment avoid repeated scene shapes, phrasing, and consequence patterns?
- Does the treatment avoid player-facing stats, levels, dice, thresholds, and optimization language?
