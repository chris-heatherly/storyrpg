# StoryRPG Treatment Prompt - Regular Episode Version

**Purpose:** Use this prompt guide when workshopping a StoryRPG season made of regular episodes. A regular episode is a playable installment that contains multiple scenes, several dramatic turns, meaningful choices, and a complete episode-level pressure movement while still serving the larger season spine.

This document is for creating a **treatment**, not playable prose. The output should give the StoryRPG generator the raw material it needs: protagonist psychology, season structure, arcs, episode outlines, scene/encounter intent, branching pressures, consequence chains, information management, visual specificity, and exactly 3 alternate season endings.

## Core StoryRPG Model

StoryRPG is choose-your-own-adventure / branching interactive fiction with visual-novel presentation and RPG-like consequence tracking hidden under fiction-first prose.

The player experiences:

- full-screen illustrated story moments
- protagonist-centered scenes
- meaningful choices
- consequences that echo later
- alternate paths that reconverge without erasing residue
- relationship, identity, information, resource, and reputation pressure
- exactly 3 alternate season endings based on repeated choice patterns

Never design around visible stats, dice, meters, levels, thresholds, builds, or optimization language. Mechanics should appear as fear, leverage, trust, injury, debt, access, temptation, preparation, reputation, information, relationship state, identity pressure, or resource pressure.

## Structural Hierarchy

Use this hierarchy for regular episodes:

```text
Season
  Acts
    Arcs
      Seven-point anchors + buffers
        Episodes
          Episode turns
            Scenes
              Beats
```

Each layer has a different job:

| Layer | Job |
|---|---|
| Season | The complete story unit. It has one season dramatic question framed around the protagonist's Lie. |
| Act | A broad season phase: setup/disruption, escalation/transformation, confrontation/aftermath. Acts are not the same as arcs. |
| Arc | A 3-8 episode pressure movement inside the season. It has its own dramatic question and finale but not season-level finality. |
| Seven-point anchor | One required season-level structural turn: hook, plotTurn1, pinch1, midpoint, pinch2, climax, resolution. |
| Buffer | Purposeful connective pressure between anchors. Buffers are not filler. |
| Episode | A playable installment with its own dramatic question, internal turn structure, and consequence-bearing end state. |
| Episode turn | A major planning movement inside an episode. Not a runtime schema. |
| Scene | A dramatic situation generated later by the pipeline. |
| Beat | The smallest visible story turn generated later by the pipeline. |

Do not make every episode a separate seven-point season. The seven points are the **season spine**. Each regular episode still needs its own dramatic shape, but it should reinforce the larger order of magnitude: scene -> episode -> arc -> season.

## Story Logic Rule: No "And Then"

The treatment should connect story units through **consequence, reversal, discovery, cost, escalation, or choice residue**, not simple chronology.

Weak chain:

```text
This happens, and then this happens, and then this happens.
```

Strong chain:

```text
The protagonist chooses X, therefore Y becomes possible.
But Y exposes Z.
Because Z is exposed, an ally changes sides.
That choice leaves a cost that shapes the next episode.
```

Every episode, scene, and major beat should be connected by **but / therefore / because / until / at the cost of**, not "and then."

## Season Architecture

### Season Dramatic Question

The season needs one central question framed around the protagonist's Lie.

Examples:

- "Can a person who believes love is transactional accept loyalty that cannot be bought?"
- "Will someone who survives by being invisible choose to be seen when others need them?"
- "Can the protagonist save their family without becoming the thing that wounded them?"

Do not state the theme as a noun. "Family" is not a theme. "What do you owe family who are destroying you?" is a theme question.

### Season Promise

Define the promise of the premise:

- **Player promise:** what the player gets to do repeatedly.
- **Emotional promise:** what the season should make the player feel.
- **Premise promise:** what kind of story situations the season must deliver.
- **Fresh variation plan:** how later episodes vary the promise instead of repeating the pilot.

The season should be a complete unit in case it stands alone, while still leaving room for a larger series meta-arc.

### Central Pressure

Define the season-long pressure that forces the protagonist's Lie into crisis. It may be:

- a person
- an institution
- a family system
- a faction
- a curse
- a debt
- a public role
- a survival situation
- an internal pattern made external by plot

The pressure must make the protagonist's old way of surviving increasingly unsustainable.

## Character Architecture

### Protagonist

The protagonist must have:

- **Want:** the conscious external goal.
- **Need:** what they actually need to recognize, accept, change, or refuse.
- **Lie:** the false belief that protects them and limits them.
- **Wound:** the past event or pattern that made the Lie useful.
- **Truth:** what growth would require them to recognize, or what they refuse in a tragic arc.
- **Arc mode:** positive, tragic, corruption, disillusionment, recovery, or ambiguous.
- **Climax choice:** the active choice that integrates the Truth or recommits to the Lie.
- **Pressure points:** relationships, fears, loyalties, temptations, secrets, debts, resources, status, or identity positions that choices can test.

Plot should pressure the Lie. Generic obstacles are weaker than obstacles tailored to this psychology.

### Supporting Characters

Major supporting characters need scaled-down versions of the same structure:

- Want
- pressure point
- micro-Lie or contradiction
- leverage over the protagonist
- what they want from the protagonist
- what they might do offscreen
- how choices can change trust, intimacy, hostility, access, secrets, or future help

Because StoryRPG is protagonist-facing, supporting characters do not need scenes without the protagonist. Their independent motivations can happen offscreen and surface through hints, changed behavior, missing information, pressure, rumors, contradictions, delayed reveals, or consequences.

## Stakes Architecture

Strong major scenes and episodes stack multiple stakes layers:

| Layer | Meaning |
|---|---|
| Material | Money, job, possessions, position, access, tools, shelter, safety resources. |
| Relational | Trust, intimacy, family bonds, friendships, alliances, loyalty, betrayal. |
| Identity | Who the protagonist becomes if they succeed or fail. |
| Existential | Survival of self, others, a community, a way of life, or something meaningful. |

Rules:

- Major scenes should usually stack at least 3 layers.
- Establish personal stakes before expanding to world-scale stakes.
- Do not jump from material to existential stakes without earning audience investment.
- Within a scene, each beat should raise what is at risk slightly until the climax beat puts the maximum scene-level risk on the table.
- Escalation must grow from character choice, prior consequences, antagonist pressure, discovery, cost, relationship change, or revealed information.

## Theme Rules

Use theme as an active question:

- The theme must be a question, not a topic.
- The protagonist's choices must be able to answer or refuse the question.
- Each episode should press the question from a different angle.
- Never have characters state the theme as thesis dialogue.
- If a scene does not press on the theme question, rewrite or cut it.

Secondary pressure lanes should thematically rhyme with the A pressure lane when they exist. They do not need protagonist-absent scenes. They can appear as relationships, obligations, secrets, recurring choices, offscreen NPC action, or alternate pressure inside protagonist-facing scenes.

## A/B/C Pressure Lanes

Regular episodes may use A/B/C pressure lanes:

- **A pressure lane:** the external main story.
- **B pressure lane:** relational, character, identity, or trust pressure that thematically rhymes with A.
- **C pressure lane:** a tonal counterweight, future seed, clue, callback, or setup for later.

Rules:

- A and B should intersect or resonate by the climax.
- B can be a subplot, relationship line, recurring choice pressure, or protagonist-facing scene.
- C should usually be a seed, not a fully competing plot.
- Do not force a B or C lane if the episode is too small, but do not let secondary characters become decorative.

## Information Management

For every key piece of information, decide its state:

- **Shared:** audience/player and protagonist know.
- **Withheld:** audience/player does not yet know.
- **Selective:** some characters know, others do not.

Default to suspense and dramatic irony when possible. Mystery has a shorter shelf life and should be used sparingly.

Rules:

- Hard cap: no more than 3 active mystery/box questions per season.
- Plan answers before introducing mysteries.
- Important payoffs need runway: 3-4 regular episodes ahead.
- Major plants should be touched at least twice before payoff when scale allows.
- Each season should close more major questions than it opens, on net.
- Surprise is best saved for act-outs, arc turns, and finales.
- Suspense often beats surprise: showing the threat creates longer tension than springing it from nowhere.

## Arc-Level Rules

An arc is a 3-8 episode pressure movement inside the season. It is not the same as an act.

- **Act:** a broad season phase.
- **Arc:** a cluster of episodes with a distinct dramatic question and pressure pattern.
- **Episode:** one playable installment inside an arc and act.

Each arc needs:

- **Arc dramatic question:** related to but distinct from the season question.
- **Relation to season question:** how this arc pressures a specific facet of the protagonist's Lie.
- **Episode-as-act-break logic:** each episode ending escalates, reverses, or reveals.
- **Midpoint recontextualization:** the middle changes the question being asked, not just the intensity.
- **Late-arc crisis:** around 2/3 through, the protagonist appears to have failed or lost the old path.
- **Earned escalation:** each episode leaves the protagonist worse off, more compromised, or knowing something they cannot unknow.
- **Arc finale:** resolves the arc question and hands pressure to the next arc without pretending to be the season finale.

If an episode's revelation could happen three episodes later without changing anything, the arc is slack.

## Episode-Level Rules

Each regular episode should have:

- **Dramatic question:** posed early and answered by the climax.
- **Cold open function:** hook + promise + optional stakes.
- **4-5 act shape:** not necessarily formal act labels, but enough turns to create setup, complication, midpoint pressure, crisis, climax, and aftermath.
- **Act-outs / turn-outs:** major transitions end on reversal, revelation, escalation, choice, cost, or memorable image/line. Never flat transition.
- **A/B/C pressure lanes where useful.**
- **Episode-level character change:** the protagonist is different at the end, even slightly.
- **No status quo restoration:** the end state cannot equal the start state.
- **Forward momentum:** the final scene plants the next episode, except the season finale, which resolves and integrates.

Regular episode planning targets:

- **3-6 scenes**
- **3-6 episode turns**
- **2-4 meaningful choice pressures**
- **1 central encounter anchor**
- **1-3 consequence seeds**

## Scene-Level Rules

Every planned scene should satisfy all four core requirements:

- **Entry goal:** the protagonist enters with intent.
- **Obstacle:** something blocks the goal.
- **Choice forced:** the protagonist must decide, reveal, risk, withhold, concede, confront, sacrifice, or commit.
- **Exit shift:** the protagonist leaves on different emotional, strategic, relational, informational, or identity footing.

Additional scene rules:

- In multi-character scenes, the power dynamic should shift at least once.
- The scene must connect to adjacent scenes by consequence, reversal, discovery, cost, escalation, or choice residue.
- If the scene can be removed without narrative consequence, cut or rewrite it.
- Use subtext over direct explanation. Characters should rarely say exactly what they mean.
- A scene should be exactly as long as needed to land its purpose. Cut to the chase; leave on the punch.

## Branching And Agency

Player agency should influence how the story unfolds without requiring infinite branching.

Rules:

- Aim for 60%+ of major plot turns to be caused by protagonist/player action, preparation, relationship leverage, sacrifice, refusal, or choice.
- Use branch-and-bottleneck structure: real divergence, planned reconvergence, persistent residue.
- Branches should change outcome, process, information, relationship, identity, resource, leverage, reputation, or ending eligibility.
- Reconvergence must not erase the path. It should retain altered dialogue, trust, help, scars, missing information, debts, or changed access.
- Prefer callbacks and scene tints for most consequences.
- Use branchlets for major choices.
- Reserve large structural branches for climaxes and endings.

Failure should create story, not a dead end:

- preparation
- training
- recovery
- mentorship
- alliance
- investigation
- information gathering
- alternate leverage
- harder route through another relationship or resource

## Visual Specificity

Be visually specific in story terms, not art-direction terms.

Useful:

- silhouettes
- clothing
- physical markers
- wounds
- props
- gestures
- spatial relationships
- environmental pressure
- repeated objects
- visible consequences
- key images

Avoid generic style words unless the user explicitly requests that style:

- cinematic
- hyperreal
- dramatic lighting
- painterly
- anime
- gritty
- glossy
- high contrast
- vivid colors

## Required Treatment Sections

Ask the LLM to create these sections.

## Machine-Readable Output Contract

The finished treatment should stay human-readable Markdown, but the generator also parses it mechanically. Use these exact structural conventions so authored intent survives ingestion:

- Use `## N. Section Name` for every required section.
- In `## 9. Episode Outline`, every episode must use `### Episode N: Title`. Do not spell out the number. Do not skip numbers. Finale headings may add `(FINALE)` after the title.
- Put `Act`, `Arc`, `Structural role`, and `Structural note` on separate bullets. Do not combine them on one line.
- Use bold top-level field labels exactly, such as `- **Episode turns:**`. Put list items only as indented child bullets under that label.
- `Structural role` must be one or more canonical role tokens only: `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, `resolution`, `rising`, or `falling`. Put explanatory text like "buffer toward Pinch 1" in `Structural note`, not `Structural role`.
- Use these exact episode field labels: `Episode dramatic question`, `Cold open function`, `A pressure lane`, `B pressure lane`, `C seed`, `Episode turns`, `Synopsis`, `Opening situation`, `Encounter anchor`, `How the encounter manifests the central conflict`, `Stakes layers present in the major scene/encounter`, `Theme angle`, `Lie pressure`, `Encounter buildup`, `Major choice pressure`, `Alternative paths`, `Information movement`, `Consequence seeds`, `Ending turnout`, `Resolved episode tension`, `Cliffhanger hook`, `Cliffhanger question`, `Next episode pressure`, `Cliffhanger setup`, `Cliffhanger type`, `Emotional charge`, and `End-state change`.
- For non-finale episodes, `Cliffhanger question` is required. It is the question hanging at the end of this episode and should become central pressure for the next episode.
- For finale episodes, use `Resolution / aftermath` instead of non-finale cliffhanger fields.
- For list fields, put child items on indented bullets under the field label. This is especially important for `Episode turns`, `Major choice pressure`, `Alternative paths`, and `Consequence seeds`.
- In `## 11. Cross-Episode Branches And Consequence Chains`, every branch must use `### Branch A: Name`, `### Branch B: Name`, etc.
- In every branch, include exact fields `Origin episode` and `Reconvergence episode`. You may write `Episode 1`, `Ep 1`, `E1`, or a range like `E1-E3`, but the explicit fields must be present.
- In `## 14. Alternate Endings`, provide exactly three headings: `### Ending 1: Name`, `### Ending 2: Name`, and `### Ending 3: Name`.
- In every ending, use the exact field label `Target conditions`.
- Do not include the prompt guide, checklist, examples, or instructions in the final treatment output. Output only the filled treatment.

### 1. Story Premise

- Title
- Genre
- Tone
- Logline
- Core fantasy
- Audience promise
- Premise promise
- Theme question
- What pressure makes inaction impossible

### 2. Season Promise And Dramatic Engine

- Season dramatic question framed around the protagonist's Lie
- Central pressure
- Player promise
- Emotional promise
- Fresh variation plan
- What a typical episode delivers after the pilot
- What the season must resolve
- What can remain open for future seasons

### 3. Character Architecture

For the protagonist:

- Name and pronouns
- Role in the world
- Want
- Need
- Lie
- Wound
- Truth
- Arc mode
- Starting identity
- Possible end states
- Climax choice
- Pressure points
- Visual identity

For each major supporting character:

- Name
- Role
- Want
- Micro-Lie or contradiction
- Leverage
- Secret or withheld pressure
- Relationship to protagonist
- Offscreen motivation or plan
- How player choices can change the relationship
- Voice notes
- Visual identity

### 4. World And Location Brief

- World premise
- Time period
- Technology/magic/supernatural rules, if any
- Power structures
- Rules that create drama
- What is forbidden, scarce, dangerous, sacred, expensive, humiliating, or socially costly
- 3-6 key locations with purpose, mood, history, and likely choice pressure

### 5. Stakes Architecture

- Primary material stakes
- Primary relational stakes
- Primary identity stakes
- Primary existential stakes
- How stakes escalate gradually
- How personal stakes are established before larger stakes
- Which relationships/places/promises make the stakes emotionally legible

### 6. Information Ledger

List major information items:

- ID / label
- What the information is
- Audience/player knowledge state: shared, withheld, or selective
- Who knows
- Who does not know
- Tension mode: suspense, dramatic irony, mystery, surprise, revelation, or foreshadowing
- Introduced episode
- Setup touch episodes
- Planned reveal or payoff episode
- Opened question IDs
- Closed question IDs
- Payoff plan

Keep mystery/box questions to 3 or fewer for the season.

### 7. 3-Act / 7-Point Season Spine

Provide one season-level beat for each:

- Hook
- Plot turn 1
- Pinch 1
- Midpoint
- Pinch 2
- Climax
- Resolution

Also provide act mapping:

```text
Act 1: Setup / Disruption
  Hook
  Rising buffer
  Plot turn 1

Act 2: Escalation / Transformation
  Rising buffer
  Pinch 1
  Rising buffer
  Midpoint
  Falling or crisis buffer
  Pinch 2

Act 3: Confrontation / Aftermath
  Falling or final-pressure buffer
  Climax
  Resolution
```

### 8. Arc Plan

For each arc:

- Arc title
- Episode range
- Arc dramatic question
- Relation to season question
- Facet of protagonist Lie under pressure
- Midpoint recontextualization
- Late-arc crisis / all-is-lost beat
- Arc finale answer
- Handoff pressure to next arc or finale
- Episode turnouts: what each episode ending escalates, reverses, reveals, costs, or makes irreversible

### 9. Episode Outline

For each episode:

- Episode number and title, formatted exactly as `### Episode N: Title`
- Act
- Arc
- Structural role: canonical token(s) only: `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, `resolution`, `rising`, or `falling`
- Structural note: anchor, fused anchor, or buffer explanation
- Episode dramatic question
- Cold open function: hook + promise + optional stakes
- A pressure lane
- B pressure lane, if present
- C seed, if present
- Episode turns: 3-6 major movements
- Synopsis: 2-4 sentences
- Opening situation
- Encounter anchor
- How the encounter manifests the central conflict
- Stakes layers present in the major scene/encounter
- Theme angle
- Lie pressure
- Encounter buildup
- Major choice pressure: 2-4 choices the episode should invite
- Alternative paths: where choices can send the player, what changes, and where paths reconverge
- Information movement: plant, touch, reveal, payoff, close, or sharpen
- Consequence seeds
- Ending turnout: consequence, reversal, discovery, cost, escalation, or choice residue
- Resolved episode tension: the immediate episode question or pressure that gets answered enough to feel authored
- Cliffhanger hook: the concrete image, line, reveal, danger, decision, betrayal, arrival, departure, loss, or emotional hook at the end
- Cliffhanger question: the unresolved question hanging at the end; for non-finales, this becomes central pressure for the next episode
- Next episode pressure: how the next episode must begin or respond because of this question
- Cliffhanger setup: the earlier detail, choice, clue, cost, or relationship pressure that earns the cliffhanger
- Cliffhanger type: revelation, danger, mystery, betrayal, arrival, departure, decision, transformation, shock, emotional_hook, reframe, or loss
- Emotional charge: the feeling the cliffhanger should leave in the player
- End-state change: why the episode cannot be removed

### 10. Scene Planning Notes

Do not write full scenes, but give key scene intent when useful.

For each important scene:

- Entry goal
- Obstacle
- Forced choice
- Exit shift
- Power shift, if multi-character
- Subtext gap
- Stakes layers
- How it connects by consequence, reversal, discovery, cost, escalation, or choice residue

### 11. Cross-Episode Branches And Consequence Chains

- 2-4 major branch points if the season has 3+ episodes
- Origin episode
- What choice or encounter outcome creates each branch
- How each branch changes a later episode
- Reconvergence episode
- What residue remains after reconvergence
- Which ending eligibility, relationship, information, identity, reputation, resource, or access state it changes

### 12. Capability, Growth, And Fail-Forward

- Key challenges that test skill, relationships, identity, resources, prior choices, or encounter outcomes
- How failure opens preparation, recovery, alliance, investigation, information, alternate leverage, or a harder route
- How growth stays fiction-first without visible stats, levels, thresholds, or grind language

### 13. Episode Endings

For each non-finale ending:

- What immediate question closes
- What bigger question opens
- The exact cliffhanger question hanging at the end of the episode
- What cost, reveal, danger, relationship rupture, choice consequence, or pressure carries forward
- How that cliffhanger question becomes the central pressure of the next episode
- What prior setup makes the cliffhanger earned
- Why this is not fake withholding

For finale/resolution:

- What central conflict resolves
- What was saved or lost
- What the protagonist becomes
- What cost remains
- What future or legacy is implied

### 14. Alternate Endings

Provide exactly 3 alternate season ending targets.

For each:

- Name
- Summary
- Emotional register
- Theme payoff
- State drivers
- Target conditions
- What repeated choice pattern this ending pays off

The three endings should be distinct emotional and thematic destinations, not success/neutral/failure reskins.

### 15. Failure Mode Audit

Before finalizing, audit for:

- **Escalation trap:** stakes rise faster than investment.
- **Mystery box collapse:** questions pile up without planned answers.
- **Character drift:** actions contradict established psychology without earned change.
- **Shaggy dog:** large setup receives weak payoff.
- **Passive protagonist:** events happen to the lead more than the lead causes them.
- **Reset disease:** episode end restores episode start.
- **Theme drift:** scenes or episodes do not press on the theme question.
- **Unmotivated escalation:** threat rises because the writer wants it to, not because the situation demands it.
- **Snowglobe arcs:** arc end restores arc beginning.
- **Inverted thematic rhyme:** B pressure lane has no relation to A pressure lane.
- **Convenient coincidence:** rescue, luck, prophecy, or outside action solves the problem.
- **Telegraphed twist:** clue language makes the reveal obvious.
- **Cheating twist:** reveal has no fair setup.

## Copy-Paste Prompt

```text
You are creating a compact story treatment for StoryRPG, a choose-your-own-adventure / branching narrative generator that turns a treatment into a visual-novel/RPG season.

This is the REGULAR EPISODE version. A regular episode contains multiple scenes, 3-6 episode turns, 2-4 meaningful choice pressures, one central encounter anchor, and a consequence-bearing ending. The season uses a 3-act / 7-point spine, but every episode should still have its own dramatic question, internal turn structure, protagonist pressure, and changed end state.

Your output is not full story prose. It is the planning document the generator will use to create episodes, scenes, choices, alternate paths, consequences, images, callbacks, information reveals, and exactly 3 alternate season endings.

Core hierarchy:
- Season -> Acts -> Arcs -> Seven-point anchors + buffers -> Episodes -> Episode turns -> Scenes -> Beats.
- Acts are broad season phases.
- Arcs are 3-8 episode pressure movements with their own dramatic questions.
- Seven-point anchors are the season spine: hook, plotTurn1, pinch1, midpoint, pinch2, climax, resolution.
- Episodes carry anchor roles, fused anchor roles, or buffer roles.
- Buffers are purposeful: escalation, consequence processing, relationship development, callbacks, preparation, recovery, investigation, or alternate leverage.
- Do not give every episode its own separate seven-point season.

Core rules:
- Fiction first: never expose stats, dice, meters, levels, thresholds, builds, or game math.
- Connect story through consequence, reversal, discovery, cost, escalation, or choice residue, not "and then."
- Theme must be a question, not a noun.
- The protagonist must have Want, Need, Lie, Wound, Truth, and an active climax choice.
- Plot should pressure the protagonist's Lie.
- Major supporting characters need Want, leverage, and a micro-Lie or contradiction scaled to screen time.
- Player choices should create alternate paths and lasting residue.
- Aim for 60%+ of major plot turns to be caused by protagonist/player action.
- Every meaningful choice should have WANT, COST, and IDENTITY.
- Choices should affect outcome, process, information, relationship, identity, resource, leverage, reputation, or ending eligibility.
- Use branch-and-bottleneck structure: real divergence, later reconvergence, persistent residue.
- Each regular episode should have one encounter anchor that manifests the episode's central conflict.
- Each episode should pose a dramatic question early and answer it by the climax.
- Non-finale episodes end with forward pressure. Finale episodes resolve the central conflict and show aftermath.
- Each non-finale episode must end on a cliffhanger question: the unresolved question hanging over the final image that becomes central pressure for the next episode.
- Cliffhangers must resolve or acknowledge the immediate episode tension, open a sharper next-episode question, carry specific emotional charge, connect to character/stakes, and feel earned by prior setup.
- Every planned scene needs entry goal, obstacle, forced choice, and exit shift.
- Major scenes should stack material, relational, identity, and/or existential stakes, usually at least 3 layers.
- Escalate gradually. Establish personal stakes before expanding to larger-scale threats.
- Use A/B/C pressure lanes when useful: A external main story, B relational/character pressure that thematically rhymes with A, C future seed or tonal counterweight.
- Supporting character motivations can happen offscreen, but must surface through protagonist-visible hints, changed behavior, pressure, secrets, or delayed reveals.
- Manage information deliberately: shared, withheld, or selective.
- Mystery/box questions are capped at 3 for the season.
- Important payoffs need 3-4 regular episodes of runway when scale allows.
- Set up twists before payoff. Do not over-telegraph twists with repeated obvious clue language.
- Conflict should cost something: physical, emotional, social, relational, resource, reputation, information, moral, or identity damage.
- Failure should create story: preparation, recovery, alliance, investigation, alternate leverage, or a harder route.
- Character emotion should be externalized through action, dialogue, silence, body language, object handling, proximity, avoidance, and choices.
- Be visually specific in story terms, not generic art-direction terms.

Create a treatment with these sections:

Output format contract:
- Use `## N. Section Name` for required sections.
- Use `### Episode N: Title` for every episode in section 9. Do not skip episode numbers. The finale may add `(FINALE)`.
- Put `Act`, `Arc`, `Structural role`, and `Structural note` on separate bullets.
- Use bold top-level field labels exactly, such as `- **Episode turns:**`. Put list items only as indented child bullets under that label.
- `Structural role` must contain only canonical token(s): `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, `resolution`, `rising`, or `falling`. Put explanatory text like "buffer toward Pinch 1" in `Structural note`.
- Use exact parse labels: `Episode dramatic question`, `Cold open function`, `A pressure lane`, `B pressure lane`, `C seed`, `Episode turns`, `Synopsis`, `Opening situation`, `Encounter anchor`, `How the encounter manifests the central conflict`, `Stakes layers present in the major scene/encounter`, `Theme angle`, `Lie pressure`, `Encounter buildup`, `Major choice pressure`, `Alternative paths`, `Information movement`, `Consequence seeds`, `Ending turnout`, `Resolved episode tension`, `Cliffhanger hook`, `Cliffhanger question`, `Next episode pressure`, `Cliffhanger setup`, `Cliffhanger type`, `Emotional charge`, `End-state change`, and finale-only `Resolution / aftermath`.
- For every non-finale episode, include `Cliffhanger question`; it is the question hanging at the end of the episode and should become central pressure for the next episode.
- For finale episodes, use `Resolution / aftermath` instead of non-finale cliffhanger fields.
- Use `### Branch A: Name` headings in section 11.
- In every branch, include exact fields `Origin episode` and `Reconvergence episode`.
- Use exactly `### Ending 1: Name`, `### Ending 2: Name`, and `### Ending 3: Name` in section 14.
- In every ending, use exact field label `Target conditions`.
- Output only the filled treatment, not this prompt guide or checklist.

1. Story Premise
- Title
- Genre
- Tone
- Logline
- Core fantasy
- Audience promise
- Premise promise
- Theme question
- What pressure makes inaction impossible

2. Season Promise And Dramatic Engine
- Season dramatic question framed around the protagonist's Lie
- Central pressure
- Player promise
- Emotional promise
- Fresh variation plan
- What a typical episode delivers after the pilot
- What the season must resolve
- What can remain open for future seasons

3. Character Architecture
For the protagonist: Name/pronouns, role, Want, Need, Lie, Wound, Truth, arc mode, starting identity, possible end states, climax choice, pressure points, visual identity.
For each major supporting character: Name, role, Want, micro-Lie or contradiction, leverage, secret or withheld pressure, relationship to protagonist, offscreen motivation/plan, how player choices can change the relationship, voice notes, visual identity.

4. World And Location Brief
- World premise
- Time period
- Technology/magic/supernatural rules, if any
- Power structures
- Rules that create drama
- What is forbidden, scarce, dangerous, sacred, expensive, humiliating, or socially costly
- 3-6 key locations with purpose, mood, history, and likely choice pressure

5. Stakes Architecture
- Material stakes
- Relational stakes
- Identity stakes
- Existential stakes
- How stakes escalate gradually
- How personal stakes are established before larger stakes

6. Information Ledger
List major information items with: ID, information, audience/player knowledge state, who knows, who does not know, tension mode, introduced episode, setup touch episodes, planned reveal/payoff episode, opened questions, closed questions, payoff plan. Keep mystery/box questions to 3 or fewer.

7. 3-Act / 7-Point Season Spine
- Hook
- Plot turn 1
- Pinch 1
- Midpoint
- Pinch 2
- Climax
- Resolution
- Act mapping across setup/disruption, escalation/transformation, confrontation/aftermath

8. Arc Plan
For each arc: title, episode range, arc dramatic question, relation to season question, protagonist Lie facet under pressure, midpoint recontextualization, late-arc crisis, arc finale answer, handoff pressure, episode turnouts.

9. Episode Outline
For each episode: episode number/title, act, arc, structural role token(s), structural note, episode dramatic question, cold open function, A pressure lane, B pressure lane if present, C seed if present, 3-6 episode turns, synopsis, opening situation, encounter anchor, how encounter manifests central conflict, stakes layers, theme angle, Lie pressure, encounter buildup, 2-4 major choice pressures, alternative paths and reconvergence, information movement, consequence seeds, ending turnout, resolved episode tension, cliffhanger hook, cliffhanger question, next episode pressure, cliffhanger setup, cliffhanger type, emotional charge, end-state change. For finale episodes, replace non-finale cliffhanger fields with resolution/aftermath.

10. Scene Planning Notes
For important scenes only: entry goal, obstacle, forced choice, exit shift, power shift if multi-character, subtext gap, stakes layers, and how the scene connects through consequence/reversal/discovery/cost/escalation/choice residue.

11. Cross-Episode Branches And Consequence Chains
- 2-4 major branch points if the season has 3+ episodes
- Origin episode for each branch
- What creates each branch
- How each branch changes a later episode
- Reconvergence episode for each branch
- What residue remains
- What ending eligibility, relationship, information, identity, reputation, resource, or access state it changes

12. Capability, Growth, And Fail-Forward
- Key challenges
- How failure opens playable story
- How growth stays fiction-first

13. Episode Endings
For each non-finale ending: immediate question closed, exact cliffhanger question opened, cost/reveal/danger/rupture/consequence/pressure carried forward, how that question becomes the next episode's central pressure, what setup earns it, and why it is not fake withholding.
For finale: central conflict resolved, what was saved/lost, what protagonist becomes, remaining cost, future or legacy.

14. Alternate Endings
Provide exactly 3 alternate season ending targets. For each: name, summary, emotional register, theme payoff, state drivers, `Target conditions`, repeated choice pattern paid off.

15. Failure Mode Audit
Check for escalation trap, mystery box collapse, character drift, shaggy dog setup, passive protagonist, reset disease, theme drift, unmotivated escalation, snowglobe arcs, inverted thematic rhyme, convenient coincidence, telegraphed twist, and cheating twist.

Keep the treatment concise but specific. Prefer concrete nouns, active conflicts, visible details, externalized emotion, consequence-bearing choices, and playable pressures over abstract theme language.
```

## Quick Quality Checklist

- Can the season dramatic question be stated in one sentence?
- Is the theme a question the protagonist's choices can answer?
- Does the protagonist have Want, Need, Lie, Wound, Truth, and an active climax choice?
- Does the plot pressure the Lie instead of throwing generic obstacles at the protagonist?
- Does every major NPC want something that can complicate the protagonist's goal?
- Are supporting character offscreen motivations visible through pressure, clues, behavior, or consequences?
- Are the 7 season-level points covered?
- Does each arc have a distinct question, midpoint recontextualization, late crisis, and finale handoff?
- Does each episode have an anchor, fused-anchor, or buffer role?
- Are buffers doing real story work?
- Does every episode have 3-6 episode turns?
- Does each episode pose and answer a dramatic question?
- Does each episode have a central encounter anchor?
- Does each encounter manifest the episode's central conflict?
- Do major scenes stack multiple stakes layers?
- Does each non-finale episode end with forward pressure rather than fake withholding?
- Does the finale resolve and integrate?
- Are there 2-4 cross-episode consequences for a multi-episode season?
- Are there exactly 3 alternate endings?
- Do all alternate endings map to repeated choices or state patterns?
- Are major payoffs planted 3-4 episodes ahead when scale allows?
- Are mystery/box questions capped at 3?
- Are choices driving at least 60% of major plot turns?
- Are scenes connected by consequence, reversal, discovery, cost, escalation, or choice residue rather than "and then"?
- Does every planned scene have entry goal, obstacle, forced choice, and exit shift?
- Are emotional beats externalized?
- Are key characters and locations visually distinct?
- Does the treatment avoid visible stats, levels, dice, thresholds, and optimization language?
