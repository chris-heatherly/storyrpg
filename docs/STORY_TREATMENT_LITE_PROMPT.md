# StoryRPG Lite Treatment Prompt Guide

**Purpose:** A shorter alternative to the full StoryRPG treatment template. Use this when you want to give the generator a canonical high-level story seed, then let the pipeline incrementally derive missing playable detail, arc pressure, branch logic, and ending drivers from that seed.

The lite treatment is not full story prose. It is a compact planning document for a branching interactive season.

## Storytelling Rules For This Lite Treatment

- **Fiction first:** never design around visible stats, dice, meters, levels, thresholds, or optimization language. Mechanics should appear as trust, fear, debt, injury, leverage, access, preparation, reputation, secrets, identity pressure, resources, or relationship state.
- **Want, cost, identity:** every meaningful choice should expose what the protagonist wants, what it costs, and what kind of person the player is choosing to become.
- **Branch and bottleneck:** choices should create real divergence, later reconverge, and leave residue through altered dialogue, trust, information, resources, reputation, visual damage, ending eligibility, or relationship tone.
- **Externalized emotion:** express feeling through action, dialogue, silence, body language, facial expression, object handling, proximity, avoidance, and choices rather than direct internal monologue.
- **Endings pay off patterns:** alternate endings should follow repeated choices, relationship states, identity patterns, flags, faction alignment, or resource states, not one arbitrary final selection.
- **Style-safe visual specificity:** describe story-visible details: silhouettes, clothing, props, wounds, gestures, spatial relationships, locations, weather, damage, and important images. Avoid generic art-direction terms unless the requested art style specifically needs them.

## Story Circle Definitions

StoryRPG uses one authoritative season-level Story Circle spine:

- **You:** the protagonist's ordinary world, identity posture, routine, protection strategy, and opening promise. This is who they are before pressure makes the old self insufficient.
- **Need:** the missing truth, contradiction, wound, external lack, or pressure proving the current identity cannot survive unchanged.
- **Go:** the threshold crossing. The protagonist commits, is forced out, enters unfamiliar pressure, or makes an irreversible move.
- **Search:** experiments, investigation, pursuit, adaptation, alliance, temptation, and escalating cost. The protagonist tries strategies before they understand the real shape of the problem.
- **Find:** the discovery, reversal, false victory, or truth that changes the meaning of the goal.
- **Take:** the real price. The protagonist loses something, pays for the new knowledge, faces betrayal or exposure, or suffers the consequence of the old strategy.
- **Return:** the movement back toward the original world, final confrontation, reckoning, or attempt to bring the answer home.
- **Change:** the changed self/world, thematic answer, aftermath, legacy, or refusal of transformation.

Use exact beat names in the treatment: `you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`. Add `(EpN)` anchors when known so the pipeline can bind authored Story Circle obligations to episode targets.

## Polarity Principle

The Story Circle works through productive tension between opposite points. Do not make opposite beats repeat the same idea.

- **You vs Go:** protected identity and home-state pressure versus crossing into unfamiliar pressure.
- **Need vs Find:** hidden lack or wound versus the revealed truth that changes the goal.
- **Search vs Take:** pursuit, experiments, and adaptation versus the price of what was learned.
- **Return vs Change:** bringing the answer home versus whether the protagonist or world actually transforms.

At the season level, name the strongest tensions clearly. At the episode level, let the pipeline derive local pressure from the assigned beat, the relevant polarity, protagonist pressure, NPC leverage, location pressure, and likely consequence.

## Copy-Paste Lite Treatment Template

```md
# StoryRPG Lite Treatment

## 1. Story Premise

- **Title:**
- **Genre:**
- **Tone:**
- **High concept pitch:** One punchy market-facing comparison or promise.
- **Logline:** One sentence.
- **Core fantasy:** What the player gets to feel or do.
- **Themes:** 3-5 short phrases.
- **Audience promise:** The emotional experience the season should deliver.

## 2. Story Circle Season Spine

Use exact Story Circle beat names. Add `(EpN)` when known.

- **You (EpN):**
- **Need (EpN):**
- **Go (EpN):**
- **Search (EpN):**
- **Find (EpN):**
- **Take (EpN):**
- **Return (EpN):**
- **Change (EpN):**

Optional:
- **Act 1:** You / Need / Go
- **Act 2:** Search / Find / Take
- **Act 3:** Return / Change

## 3. Story Arcs

For each major story arc:

### Arc: Name

- **Episode range:**
- **Story Circle span:** Start beat, end beat, and owned beats.
- **Arc question:** The dramatic question this arc answers or complicates.
- **Pressure movement:** What changes across the arc.
- **Protagonist polarity:** Which internal tension this arc pushes against.
- **Key NPC/location pressure:** Who or what makes the arc harder.
- **Handoff:** What unresolved pressure makes the next arc necessary.

## 4. Protagonist Brief

- **Name and pronouns:**
- **Role in the world:**
- **Want:**
- **Need:**
- **Lie or survival posture:**
- **Wound or origin pressure:**
- **Truth or possible transformation:**
- **Starting identity:**
- **Possible end states:** 2-4 options.
- **Visual identity:**

## 5. Major NPC Briefs

For each major NPC:

### NPC: Name

- **Role:**
- **Want:**
- **Leverage:**
- **Secret or contradiction:**
- **Relationship to protagonist:**
- **Voice / visual notes:**

## 6. World And Location Brief

- **World premise:**
- **Time period:**
- **Rules that create drama:** Magic, technology, supernatural rules, social rules, scarcity, taboos, danger, or power structures.
- **Key locations:** 3-6 locations, each with purpose, mood, and likely choice pressure.

## 7. Episode Outline

For each episode:

### Episode N: Title

- **Story Circle role:** Use exact beat names: `you`, `need`, `go`, `search`, `find`, `take`, `return`, `change`; fused adjacent beats are allowed.
- **High-level description:** No more than 6 sentences.
- **Major pressure:** The main conflict, question, or decision.
- **Likely consequence:** What should be changed by the end.

## 8. Alternate Endings

Provide exactly 3 alternate season endings.

### Ending 1: Name

No more than 6 sentences. Include emotional destination, thematic meaning, and the repeated choice pattern or state that should lead here.

### Ending 2: Name

No more than 6 sentences.

### Ending 3: Name

No more than 6 sentences.
```

## Quick Lite Checklist

- Does the Story Premise include title, genre, tone, high concept pitch, logline, core fantasy, themes, and audience promise?
- Does the high concept pitch stay short, memorable, and specific enough for the pipeline to preserve as a canonical promise?
- Does each Story Circle spine beat have a concrete season-level event, not just an abstract label?
- Is every Story Circle beat represented exactly once as a primary beat or as part of a fused adjacent assignment?
- Do opposite Story Circle poles create tension rather than repeat each other?
- Does each story arc have an episode range, Story Circle span, arc question, pressure movement, polarity, and handoff?
- Does each handoff clearly identify the pressure that makes the next arc necessary?
- Does the story flow coherently and have a compelling narrative?
- Does the treatment contain logical or causal inconsistencies or anachronisms that are not intended?
- Does the Protagonist Brief include want, need, lie/survival posture, origin pressure, possible transformation, and possible end states?
- Does each major NPC have role, want, leverage, secret/contradiction, relationship, and voice/visual notes?
- Does the World And Location Brief include world premise, time period, drama rules, and 3-6 key locations?
- Does each episode have a Story Circle role, high-level description, major pressure, and likely consequence?
- Are episode descriptions no more than 6 sentences?
- Are there exactly 3 alternate endings?
- Are alternate endings no more than 6 sentences each?
- Are endings tied to repeated choices, identity, relationships, flags, factions, or resources?
- Does the treatment avoid visible stats, dice, meters, levels, thresholds, and optimization language?
