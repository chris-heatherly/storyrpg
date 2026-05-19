# Story Treatment MVP Prompt Guide

**Purpose:** A streamlined guide for prompting an LLM to create a choose-your-own-adventure / branching narrative story treatment that gives the StoryRPG generator the right raw material: character briefs, a season and episode outline, episode cliffhangers, meaningful choices, alternate consequence-bearing paths, exactly 3 alternate season endings, and the storytelling rules that make those inputs useful downstream.

Use this when you are not asking the model to generate the full playable story. The goal is a compact, high-signal treatment for a branching interactive season: clear anchors, character pressure, episode structure, cliffhanger pacing, choice pressure, alternative paths, and consequence opportunities.

## What The Treatment Must Do

A good treatment gives the generator enough intent to produce authored-feeling interactive fiction:

- A clear protagonist goal, wound, pressure, and possible transformation.
- A small cast with distinct desires, secrets, leverage, and relationships.
- A season spine built around the 3-act / 7-point structure.
- A season and episode outline where every episode has a mini-arc, one dramatic encounter anchor, and a cliffhanger or turn.
- Meaningful choose-your-own-adventure choices that are about identity under pressure, not optimization.
- Alternative paths where player choice has consequence.
- Branches that are finite, meaningful, and reconvergent.
- Exactly 3 alternate endings per season.
- Enough visual and world specificity for images and scenes to stay coherent.

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

### 3. 7-Point Spine

Provide one season-level beat for each:

- **Hook:** the opening image/situation that shows the world and dramatic promise.
- **Plot turn 1:** the commitment point; the protagonist cannot go back.
- **Pinch 1:** the antagonist/system proves it can hurt them.
- **Midpoint:** a revelation, reversal, or false victory that changes the meaning of the goal.
- **Pinch 2:** the cost becomes personal and the old strategy fails.
- **Climax:** the hardest choice or confrontation.
- **Resolution:** the emotional and thematic landing.

Each episode should carry at least one of these beats, even in a short season where episodes combine beats.

### 4. Protagonist Brief

Minimum fields:

- **Name and pronouns**
- **Role in the world**
- **External goal**
- **Internal wound or contradiction**
- **Starting identity:** how they tend to solve problems at the beginning.
- **Possible end states:** 2-4 ways they can become different depending on choices.
- **Pressure points:** relationships, fears, loyalties, temptations, or secrets that choices can test.
- **Visual identity:** silhouette, clothing, age read, physical markers, emotional bearing.

Rule: the protagonist should not be generically capable. Give them a strength that causes problems and a weakness that sometimes helps.

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
- **Visual identity:** distinct silhouette and costume/appearance details.

MVP cast size: 3-6 major NPCs. More than that tends to dilute early episodes unless the story needs an ensemble.

### 6. World And Location Brief

Minimum fields:

- **World premise**
- **Time period**
- **Technology/magic/supernatural rules, if any**
- **Power structures:** factions, institutions, families, crews, faiths, corporations, etc.
- **Rules that create drama:** what is forbidden, scarce, dangerous, sacred, or socially costly.
- **3-6 key locations:** each with purpose, mood, history, and what kinds of choices happen there.

Rule: worldbuilding should create choices. A detail is useful if it gives the protagonist leverage, danger, temptation, identity pressure, or a later callback.

### 7. Episode Outline

For each episode:

- **Episode number and title**
- **Structural role:** which 7-point beat(s) it carries.
- **Episode promise:** what dramatic question this episode answers.
- **Synopsis:** 2-4 sentences.
- **Opening situation**
- **Encounter anchor:** the central confrontation, negotiation, chase, investigation, heist, survival test, puzzle, or social rupture.
- **Encounter buildup:** what the earlier scenes establish so the encounter choices feel loaded.
- **Major choice pressure:** 2-4 meaningful choices the episode should invite.
- **Alternative paths:** where choices can send the player, what changes, and where paths reconverge.
- **Consequence seeds:** flags, relationships, secrets, injuries, debts, clues, or identity shifts that can echo later.
- **Cliffhanger or turn:** the final hook into the next episode.

Episode rule: each episode should feel like the reason it exists is the encounter. The scenes before it load the emotional, informational, and relational ammunition; the scenes after it show the cost.

### 8. Branching And Consequences

Plan a finite set of branches:

- **2-4 cross-episode branch points** for a season of 3+ episodes.
- Each branch should create a different experience later, then reconverge at a bottleneck.
- Each branch should leave residue after reconvergence: altered dialogue, relationship tone, available help, visual damage, missing information, or changed ending eligibility.
- Prefer callbacks and scene tints for most consequences; use branchlets for major choices; reserve structural branches for climaxes and endings.

Every meaningful choice should affect at least one of:

- **Outcome:** what happens.
- **Process:** how the player gets there.
- **Information:** what the player learns or misses.
- **Relationship:** how someone feels or behaves toward the protagonist.
- **Identity:** what kind of person the protagonist is becoming.

### 9. Cliffhangers

Each episode needs a deliberate cliffhanger or turn that follows the project's pacing rules: resolve the immediate episode pressure enough to feel satisfying, then open a new question, cost, reveal, or danger that pulls the player into the next episode.

Each episode ending should do at least one of:

- Reveal new information that changes the player's understanding.
- Force a decision whose consequences begin next episode.
- Recontextualize an ally, enemy, location, or goal.
- Show the cost of the player's prior success.
- Open a new danger while resolving the episode's immediate conflict.

Avoid fake cliffhangers that simply withhold obvious information. The best cliffhangers are turns of meaning, not just interruptions.

### 10. Alternate Endings

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

- **Fiction first:** never design around visible stats, dice, meters, levels, or optimization language. Mechanics should appear as fear, leverage, trust, injury, debt, access, temptation, preparation, or reputation.
- **Choose-your-own-adventure form:** design for branching narrative play, where the player reads, chooses, experiences consequences, and sees alternate paths converge into later story anchors.
- **Want + cost + identity:** every important choice needs a clear desire, a real price, and a self-defining implication.
- **Pressure reveals character:** choices should ask "who are you under pressure?" more often than "which option is correct?"
- **Branch and bottleneck:** create real divergence, then reconverge at planned anchors without erasing the player's path.
- **Delayed memory:** important decisions should return later through callbacks, altered relationships, scene tints, changed information, or ending eligibility.
- **Encounter-first episodes:** each episode needs a dramatic center that tests the episode's relationships, secrets, skills, and theme.
- **Setup before payoff:** twists, reversals, rescues, betrayals, and endings need earlier plants.
- **Escalation with variation:** pressure should rise across the season, but episode encounters should vary in kind and emotional texture.
- **Characters want different things:** every major NPC should be able to create friction even when they are helpful.
- **No purely cosmetic drama:** a secret, clue, item, wound, promise, or relationship should matter later if the treatment spotlights it.
- **Visual specificity:** name what should be seen, not just felt. Give characters, locations, and key moments concrete visual handles.

## Copy-Paste Prompt

```text
You are creating a compact story treatment for StoryRPG, a choose-your-own-adventure / branching narrative generator that turns a treatment into a visual-novel/RPG season.

Your output is not the full story prose. It is the planning document the generator will use to create episodes, scenes, meaningful choices, alternate paths, encounters, images, episode cliffhangers, and exactly 3 alternate season endings.

Core rules:
- Fiction first: never expose stats, dice, meters, or game math.
- This is choose-your-own-adventure branching narrative: player choices must create alternate paths and consequences.
- Every meaningful choice should have WANT, COST, and IDENTITY.
- Choices should affect outcome, process, information, relationship, or identity.
- Use branch-and-bottleneck structure: real divergence, later reconvergence, persistent residue.
- Each episode should have one dramatic encounter anchor that the rest of the episode builds toward.
- Every episode needs a cliffhanger or turn: resolve the immediate episode pressure, then open a new question, cost, reveal, or danger.
- Set up twists before payoff. Let decisions echo later.
- Create exactly 3 alternate season endings. Endings should pay off repeated choice patterns, not one arbitrary final choice.
- Be visually specific enough for image generation: concrete character silhouettes, costumes, locations, props, moods, and key images.

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

3. 7-Point Season Spine
- Hook
- Plot turn 1
- Pinch 1
- Midpoint
- Pinch 2
- Climax
- Resolution

4. Protagonist Brief
- Name and pronouns
- Role in the world
- External goal
- Internal wound or contradiction
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
- Structural role from the 7-point spine
- Episode promise
- Synopsis
- Opening situation
- Encounter anchor
- Encounter buildup
- Major choice pressure: 2-4 choices the episode should invite
- Alternative paths: where choices can send the player, what changes, and where paths reconverge
- Consequence seeds
- Cliffhanger or turn

8. Cross-Episode Branches And Consequence Chains
- 2-4 major branch points if the season has 3+ episodes
- What choice or encounter outcome creates each branch
- How each branch changes a later episode
- Where it reconverges
- What residue remains after reconvergence

9. Alternate Endings
Provide exactly 3 alternate season ending targets. For each:
- Name
- Summary
- Emotional register
- Theme payoff
- State drivers
- Target conditions

Keep the treatment concise but specific. Prefer concrete nouns, active conflicts, visible details, and playable pressures over abstract theme language.
```

## Quick Quality Checklist

Before using a treatment as generator input, check:

- Can you state the protagonist's goal and stakes in one sentence?
- Does every major NPC want something that can complicate the protagonist's goal?
- Does every episode have a dramatic encounter anchor?
- Does every episode end with a real cliffhanger, turn, cost, reveal, or unresolved decision?
- Are the 7-point beats covered across the season?
- Are there 2-4 cross-episode consequences for a multi-episode season?
- Are there exactly 3 alternate season endings?
- Do all alternate endings map to repeated choices or state patterns?
- Are key characters and locations visually distinct?
- Does the treatment avoid player-facing stats, levels, dice, and optimization language?
