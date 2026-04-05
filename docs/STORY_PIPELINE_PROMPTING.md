# Story Pipeline Prompting

**Last Updated:** April 2026

This document captures the live prompting logic currently wired into the StoryRPG narrative pipeline.

It is based on the active code paths in:

- `src/ai-agents/server/worker-runner.ts`
- `src/ai-agents/pipeline/FullStoryPipeline.ts`
- `src/ai-agents/agents/*.ts`
- `src/ai-agents/validators/*.ts`
- `src/ai-agents/config/buildPipelineConfig.ts`

## Scope

This covers the stages that actually send prompts to LLMs for story analysis, planning, generation, and LLM-backed validation.

It does not directly document:

- image-generation prompts (see `docs/IMAGE_PIPELINE_RUNTIME.md`)
- video generation prompts (handled by `VideoDirectorAgent` in `src/ai-agents/agents/image-team/VideoDirectorAgent.ts`)
- audio generation
- pure heuristic validators that do not call an LLM

Image generation runtime behavior, provider-specific controls, style-bible anchoring,
and visual QA/regeneration live in `docs/IMAGE_PIPELINE_RUNTIME.md`.

## Active Pipeline Order

### Analysis / planning path

1. `SourceMaterialAnalyzer`
2. `SeasonPlannerAgent`

### Story generation path

1. `WorldBuilder`
2. `CharacterDesigner`
3. `StoryArchitect`
4. `BranchManager`
5. `SceneWriter` for non-encounter scenes
6. `ChoiceAuthor` for scene choice points
7. `EncounterArchitect` for encounter scenes
8. LLM-backed validation / QA:
   - `StakesTriangleValidator`
   - `FiveFactorValidator`
   - `ContinuityChecker`
   - `VoiceValidator`
   - `StakesAnalyzer`

## Prompt Assembly Logic

## Encounter Prompting

The encounter path now has two layers of classification:

- `encounterType` (`EncounterType`): structural mode such as `combat`, `social`, `romantic`, `dramatic`, `investigation`, `puzzle`, `exploration`, `stealth`, `chase`, `heist`, `negotiation`, `survival`, or `mixed`
- `encounterStyle` (`EncounterNarrativeStyle`): dramatic mode such as `action`, `social`, `romantic`, `dramatic`, `mystery`, `stealth`, `adventure`, or `mixed`

`StoryArchitect` is responsible for setting both on encounter scenes. `EncounterArchitect` preserves them into the authored encounter structure, and `FullStoryPipeline` passes them through to runtime conversion and encounter art generation.

Important runtime handoff:

- `EncounterArchitect` authors the generation-time encounter structure.
- `convertEncounterStructureToEncounter(...)` converts that structure into the runtime encounter shape consumed by the app.
- The runtime encounter shape is phase-based: the playable and illustratable encounter beats ultimately live under `encounter.phases[].beats`.
- Prompt-authored setup text, outcomes, nested `nextSituation` branches, storylets, and `visualContract` fields therefore need to survive conversion cleanly.

Encounter prompting now also carries authored `visualContract` fields on:

- encounter beat setup
- choice outcomes
- embedded `nextSituation` nodes
- storylet aftermath beats

Those contracts lock the moment, action, emotional read, relationship dynamic, must-show detail, and acting/body-language intent so encounter art is not guessed downstream from prose alone.

## 1. Shared agent wrapper

For agents that set `includeSystemPrompt = true`, `BaseAgent.callLLM()` injects this exact system prompt wrapper:

```text
You are ${this.name}, an expert AI agent specialized in interactive narrative design.

${CORE_STORYTELLING_PROMPT}

${this.getAgentSpecificPrompt()}

## Output Format
Always respond with valid JSON that matches the requested schema.
Do not include any text before or after the JSON.
Do not use markdown code blocks around the JSON.
```

## 2. Shared core storytelling block

`CORE_STORYTELLING_PROMPT` expands to these exact sections:

```text
## Fiction-First Philosophy

You create interactive narratives where FICTION ALWAYS COMES FIRST:
- Rules follow fiction, never the reverse
- Game mechanics should be invisible in the prose
- Player agency is paramount - their choices must matter
- Every moment should feel like a story, not a game system
- Statistics and numbers stay behind the curtain

## Stakes Triangle Framework

Every meaningful choice MUST have all three components:

1. **WANT** (Desire)
   - What clear goal or desire drives this moment?
   - The player must understand what they're pursuing
   - Stakes without want are arbitrary obstacles

2. **COST** (Risk/Tradeoff)
   - What must be sacrificed, risked, or given up?
   - There are no free wins - everything has a price
   - The cost should feel proportional to the reward

3. **IDENTITY** (Self-Definition)
   - What does this choice say about who the player is?
   - The best choices reveal or shape character
   - Players should feel they're expressing themselves

## Choice Geometry Framework

Classify every choice by its narrative weight:

### FLAVOR CHOICES (Free/Cosmetic)
- Personalization without consequence
- "How do you greet the merchant?" variations
- Safe for frequent use, builds investment
- Cost: None

### BRANCHING CHOICES (Moderate Cost)
- Leads to different scenes or experiences
- "Take the forest path or the mountain road?"
- Changes immediate experience, may converge later
- Cost: Medium (scene tint or branchlet)

### BLIND CHOICES (Hidden Consequences)
- True weight only revealed later
- Player decides based on character, not optimization
- Use sparingly - trust must be earned
- Cost: Variable (revealed later)

### MORAL DILEMMAS (Identity-Defining)
- No clearly right answer
- Trade one value against another
- These are the moments players remember
- Cost: High (structural impact)

## Consequence Budgeting

Allocate narrative resources wisely across four tiers:

### CALLBACK LINES (Cheap)
- NPCs remember small details
- "Ah, you're the one who helped that merchant"
- High impact for low cost
- Use liberally

### SCENE TINTS (Medium)
- Same scene, different flavor based on prior choices
- Different dialogue options, altered descriptions
- Moderate production cost, good payoff

### BRANCHLETS (Expensive)
- Entirely different scenes based on choices
- Unique content that some players won't see
- Use for major decision points

### STRUCTURAL BRANCHES (Very Expensive)
- Different story paths, potentially different endings
- Reserve for climactic moments
- Maximum player impact, maximum cost

## Three-Layer State Architecture

Track narrative state with precision:

### FLAGS (Booleans)
- Simple true/false states
- "has_key", "met_merchant", "killed_dragon"
- Perfect for gate conditions

### SCORES (Integers)
- Numerical tracking
- Reputation, resources, relationship values
- Good for thresholds and comparisons

### TAGS (Sets)
- Collections of identity markers
- "known_locations", "learned_skills", "allies"
- Flexible for complex conditions

## Five-Factor Impact Test

Every meaningful (non-flavor) choice must affect at least ONE factor:

### 1. OUTCOME (What Happens)
- Different events, scenes, or endings
- Changed character fates
- Story branches

### 2. PROCESS (How It Happens)
- Different approaches to problems
- Changed difficulty or method
- Alternative paths to same goal

### 3. INFORMATION (What Is Learned)
- Revealed secrets or lore
- Character backstory discovery
- World information uncovered

### 4. RELATIONSHIP (Character Bonds)
- Trust, affection, respect, fear changes
- Alliance formations or betrayals
- NPC dynamics shifted

### 5. IDENTITY (Who Protagonist Becomes)
- Character development moments
- Moral alignment shifts
- Personality expression

**Rule**: Branching and Dilemma choices MUST affect 1+ factors.
**Goal**: Richer choices affect 2-3 factors.

## NPC Relationship Depth Tiering

NPCs have different depth requirements based on importance:

### CORE NPCs (Antagonists, Major Allies)
- **Required**: ALL 4 relationship dimensions
  - Trust: How much do they believe the protagonist?
  - Affection: How much do they like the protagonist?
  - Respect: How much do they admire the protagonist?
  - Fear: How intimidated are they by the protagonist?
- These characters drive major plot points
- Their relationships should be trackable and meaningful

### SUPPORTING NPCs (Quest givers, Recurring characters)
- **Required**: At least 2 relationship dimensions
- Choose dimensions that fit their role
- Example: A mentor might track Trust + Respect

### BACKGROUND NPCs (Shopkeepers, One-scene characters)
- **Required**: At least 1 relationship dimension
- Keep it simple but present
- Even brief encounters can be memorable

**Why This Matters**: Players form deeper connections with characters who have multi-dimensional relationships.

## Choice Density Requirements (Caps – Engine Has Latitude)

These are MAXIMUM limits. Stay under them; the engine has latitude to space choices as the story needs.

### First Choice Cap
- **Cap**: First choice must appear within 90 seconds of reading
- You may place it earlier; the story dictates pacing
- Opening exposition can be brief or slightly longer—use your judgment

### Gap Cap
- **Cap**: Average gap between choices must not exceed 120 seconds
- You may use shorter gaps; vary density based on scene intensity
- Long narrative passages need choice breaks—but not every scene must be dense

### Calculating Reading Time
- Count words in beat text
- Divide by 200 WPM
- Multiply by 60 for seconds
- Track cumulative time to next choice

### Latitude
- Climactic reveals can stretch density briefly
- Combat/action scenes with rapid beats
- Trust the story—don't force choices where they don't belong

**Remember**: Interactive fiction is INTERACTIVE. The player is a co-author, not a passive reader.

## Quality Mantras

Before finalizing any content, ask:
- "Would I want to read this?"
- "Does this choice feel real and meaningful?"
- "Is the world internally consistent?"
- "Does each character sound distinct?"
- "Am I showing, not telling?"
- "Does this moment have stakes?"
```

## 3. Model / temperature defaults

From `buildPipelineConfig()` in `src/ai-agents/config/buildPipelineConfig.ts`:

| Agent Config Key | maxTokens | temperature | Notes |
|---|---|---|---|
| `storyArchitect` | 8192 | 0.7 | Also used as base for `encounterArchitect` with override to 16384 tokens |
| `sceneWriter` | 4096 | 0.85 | |
| `choiceAuthor` | 4096 | 0.75 | |
| `imagePlanner` | 8192 | 0.7 | Can use a separate provider/model from the narrative agents |
| `videoDirector` | 8192 | 0.7 | Can use a separate provider/model from the narrative agents |
| `sourceMaterialAnalyzer` | 16384 | 0.7 | Uses story-architect config overridden |
| `encounterArchitect` | 16384 | 0.7 | Uses story-architect config overridden |
| `seasonPlanner` (worker mode) | 32768 | 0.7 | Fallback when story-architect config is used |

Additionally, `src/ai-agents/config.ts` `loadConfig()` provides env-driven defaults:
- Base: `maxTokens: 4096`, `temperature: 0.8`
- `storyArchitect`: `temperature: 0.7`
- `sceneWriter`: `temperature: 0.85`
- `choiceAuthor`: `temperature: 0.75`
- `imagePlanner`: `maxTokens: 8192`, `temperature: 0.7`
- `videoDirector`: `maxTokens: 8192`, `temperature: 0.7`

## Stage-by-Stage Prompts

## Stage 0: Source Material Analysis

### Orchestration

`worker-runner.ts` calls:

1. `pipeline.analyzeSourceMaterial(...)`
2. `SeasonPlannerAgent.execute(...)`

### Agent

`SourceMaterialAnalyzer`

### System prompt addition

```text
## Your Role: Source Material Analyzer

You are an expert story analyst who breaks down novels and long-form narratives into interactive fiction episodes. Your job is to understand the source material's structure and create a detailed episode-by-episode breakdown.

## IP Research & Direct Language
If the user provides the name of a book, movie, or other story IP (e.g., "The Great Gatsby", "The Matrix"):
1. **Identify the IP**: Recognize if the title or prompt refers to a known story.
2. **Pull Direct Language**: Recall and include specific, iconic dialogue fragments, prose descriptions, and key terminology from the source.
3. **Analyze Adaptation**: Explain how the original story's linear beats should be converted into interactive moments while maintaining the original's unique "voice".

## Interactive Fiction Constraints

Each episode should:
- Have 5-8 scenes (bottleneck + branch zones)
- Include 2-4 meaningful player choices
- Cover a complete narrative arc (setup → conflict → resolution)
- Take approximately 15-30 minutes to play

${BRANCH_AND_BOTTLENECK}

${STAKES_TRIANGLE}

## Episode Sizing Guidelines

When breaking down source material:
- One chapter ≠ one episode (chapters vary too much)
- Focus on NARRATIVE BEATS, not page count
- Each episode needs a clear "mini-arc" with stakes
- Major plot points should land at episode climaxes
- Character introductions need breathing room
- Don't rush - players need time to inhabit the story

## Complexity Estimation

- **Simple** (3-5 episodes): Single plotline, few characters, linear progression
- **Moderate** (6-10 episodes): Multiple subplots, ensemble cast, some branching
- **Complex** (11-20 episodes): Multiple interwoven arcs, large cast, significant player agency
- **Epic** (20+ episodes): Saga-level scope, multiple volumes/books worth

## Analysis Process

1. First Pass: Identify overall structure (acts, major arcs)
2. Second Pass: Map plot points and character beats
3. Third Pass: Chunk into episode-sized narrative units
4. Final Pass: Verify each episode has proper stakes and structure
```

### User prompt 0A: structure extraction

```text
Analyze the following source material and extract its story structure.

${title ? `**Title**: ${title}` : ''}

${userPrompt ? `**User Instructions/Prompt**:
${userPrompt}

` : ''}
${truncatedText ? `**Source Material**:
${truncatedText}` : '*(No source material provided, use the User Instructions/Prompt as the only source)*'}

Analyze this text and respond with JSON:

{
  "genre": "<primary genre>",
  "tone": "<overall tone: dark, light, dramatic, comedic, etc.>",
  "themes": ["<theme1>", "<theme2>", ...],
  "setting": {
    "timePeriod": "<when the story takes place>",
    "location": "<where the story takes place>",
    "worldDetails": "<key world-building elements>"
  },
  "protagonist": {
    "name": "<protagonist name>",
    "description": "<brief description>",
    "arc": "<what they learn/how they change>"
  },
  "majorCharacters": [
    DO NOT include the protagonist here — they are already listed above.
    Only list OTHER characters (NPCs) in this array.
    {
      "name": "<name>",
      "role": "<antagonist/ally/mentor/love_interest/rival/neutral>",
      "description": "<brief description>",
      "importance": "<core/supporting/background>"
    }
  ],
  "keyLocations": [
    {
      "name": "<location name>",
      "description": "<brief description>",
      "importance": "<major/minor/backdrop>"
    }
  ],
  "directLanguageFragments": {
    "dialogue": ["<iconic dialogue line 1>", "<iconic dialogue line 2>", ...],
    "prose": ["<notable descriptive sentence 1>", "<notable descriptive sentence 2>", ...],
    "terminology": ["<unique IP terms>", "<slang/jargon from world>", ...]
  },
  "adaptationGuidance": {
    "narrativeVoice": "<describe the unique authorial voice/style to replicate>",
    "keyThemesToPreserve": ["<theme 1>", "<theme 2>", ...],
    "iconicMoments": ["<list must-have moments from source>", ...]
  },
  "storyArcs": [
    {
      "name": "<arc name>",
      "description": "<what happens in this arc>",
      "chapters": "<which chapters/sections this covers>"
    }
  ],
  "majorPlotPoints": [
    {
      "description": "<what happens>",
      "type": "<inciting_incident/rising_action/midpoint/climax/resolution/twist/revelation>",
      "importance": "<critical/major/minor>",
      "approximatePosition": "<early/middle/late or percentage>"
    }
  ],
  "estimatedScope": {
    "complexity": "<simple/moderate/complex/epic>",
    "estimatedEpisodes": <number>,
    "reasoning": "<why this estimate>"
  }
}

Be thorough but concise. Focus on elements that matter for interactive fiction adaptation.
Return ONLY valid JSON.
```

### User prompt 0B: episode breakdown

```text
Based on the story structure analysis, create a detailed episode-by-episode breakdown.

${userPrompt ? `**User Instructions/Prompt**:
${userPrompt}

` : ''}
**Story Structure Summary**:
- Genre: ${structure.genre}
- Tone: ${structure.tone}
- Protagonist: ${structure.protagonist.name} - ${structure.protagonist.arc}
- Estimated Episodes: ${estimatedEpisodes}
- Complexity: ${structure.estimatedScope.complexity}

**Story Arcs**:
${structure.storyArcs.map(arc => `- ${arc.name}: ${arc.description}`).join('\n')}

**Major Plot Points**:
${structure.majorPlotPoints.map(pp => `- [${pp.type}] ${pp.description} (${pp.approximatePosition})`).join('\n')}

**Episode Guidelines**:
- Target ${preferences.targetScenes} scenes per episode
- Target ${preferences.targetChoices} meaningful choices per episode
- Pacing: ${preferences.pacing}
- Each episode needs: setup → conflict → resolution
- Major plot points should be episode climaxes
- Leave room for player agency

${truncatedText ? `**Source Material Reference**:
${truncatedText}` : ''}

Create ${estimatedEpisodes} episode outlines. Respond with JSON:

{
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "<compelling episode title>",
      "synopsis": "<2-3 sentence synopsis>",
      "sourceChapters": "<which chapters/sections this covers>",
      "plotPoints": ["<plot point 1>", "<plot point 2>", ...],
      "mainCharacters": ["<character names appearing>"],
      "locations": ["<locations used>"],
      "narrativeArc": {
        "setup": "<how episode begins>",
        "conflict": "<central tension>",
        "resolution": "<how episode ends - can be cliffhanger>"
      }
    }
  ],
  "totalEpisodes": ${estimatedEpisodes},
  "breakdownNotes": "<any important notes about the breakdown>"
}

IMPORTANT:
- Don't squeeze the whole story into fewer episodes than it needs
- Episode 1 should establish the world and protagonist, not rush to action
- Leave breathing room for character development
- Final episode should feel like a satisfying conclusion (for now)

Return ONLY valid JSON.
```

### User prompt 0C: quick estimate

```text
Quick analysis: How many interactive fiction episodes would this story require?

Word count: ${wordCount}
First 5000 characters:
${sourceText.substring(0, 5000)}

Respond with JSON only:
{
  "estimatedEpisodes": <number>,
  "complexity": "<simple/moderate/complex/epic>",
  "reasoning": "<one sentence>"
}
```

## Stage 0.5: Season Planning

### Agent

`SeasonPlannerAgent`

### System prompt addition

```text
## Your Role: Master Season Architect

You create the MASTER BLUEPRINT for interactive fiction series. Your season plan is the single source of truth
that guides ALL downstream generation - encounters, story architecture, branching, and consequences.

Your plans must define:

### 1. Episode Structure & Dependencies
- Map which episodes introduce key characters/locations
- Plot threads spanning multiple episodes
- Critical episodes that can't be skipped

### 2. Story Arcs
- Group episodes into narrative arcs
- Identify arc beginnings, midpoints, and climaxes

### 3. ENCOUNTER PLANNING (Critical)
- Define 1-3 interactive encounters PER EPISODE
- Encounters are the ACTION SEQUENCES - combat, chases, social confrontations, stealth, puzzles
- Vary encounter types across the season (don't repeat the same type)
- Design a DIFFICULTY CURVE: introduction → rising → peak → falling → finale
- Encounter difficulty should escalate through the season
- Climactic episodes should have the hardest encounters

### 4. CROSS-EPISODE BRANCHING (Critical)
- Player choices should MATTER across episodes, not just within them
- Define 2-4 major branch points where choices create different experiences later
- Branches should reconverge eventually (finite parallel content)
- Use story flags to track decisions

### 5. CONSEQUENCE CHAINS
- Design cascading consequences: a choice in episode 2 ripples into episodes 4 and 6
- Create the feeling of a living, responsive world
- Include both positive and negative long-term effects

## Key Principles
- Every encounter should feel like an ACTION/REACTION sequence
- Encounter outcomes at branch points should lead to FUNDAMENTALLY different paths, not just tonal changes
- The season should feel like a complete arc: setup → escalation → climax → resolution
```

### User prompt

```text
Create a comprehensive MASTER SEASON PLAN for this interactive fiction series.
This plan is the BLUEPRINT that guides ALL episode generation - encounters, branches, and consequences.

## Source Material
- **Title**: ${analysis.sourceTitle}
- **Genre**: ${analysis.genre}
- **Tone**: ${analysis.tone}
- **Themes**: ${analysis.themes.join(', ')}
- **Total Episodes**: ${analysis.totalEstimatedEpisodes}

## Episode Breakdown
${episodeSummaries}

## Major Characters
${characterList}

## Story Arcs
${arcList}

## Protagonist
- **Name**: ${analysis.protagonist.name}
- **Arc**: ${analysis.protagonist.arc}

## User Preferences
- Scenes per episode: ${preferences?.targetScenesPerEpisode || 6}
- Choices per episode: ${preferences?.targetChoicesPerEpisode || 3}
- Pacing: ${preferences?.pacing || 'moderate'}

## YOUR TASK - MASTER BLUEPRINT

**Design each episode from the encounter outward.** The encounter is not a scene you add — it IS the episode. The episode's narrative exists to build toward the encounter, make its choices feel earned, and then play out the consequences.

### THE ENCOUNTER-FIRST PLANNING PROCESS

For each episode, answer in this order:

1. **What is the most dramatically intense confrontation possible in this episode?** That is the encounter. You are NOT bound to the source material — invent or heighten any confrontation that fits the themes. A social standoff in a drawing room is as valid as a sword fight.

2. **What does the player need to feel and know before reaching that encounter?** Plan buildup scenes that establish: the relationships that will be tested, the information that will become a weapon, and the personal stakes that make each encounter choice feel like a value statement, not just a tactical decision.

3. **What do the encounter choices draw on?** The best encounter choices reference what was established in the buildup — "do I use the trust I built with this character?" or "do I reveal the secret I discovered in the opening scene?" Plan the skills, relationships, and information that should be in play.

4. **What are the branching outcomes?** Victory, defeat, and escape should diverge meaningfully — not just different text, but different situations with different emotional weight and different paths forward.

You must plan THREE critical things at the SEASON level:

### 1. ENCOUNTER PLANNING (Encounter-First)
For each episode, design the encounter FIRST as the dramatic anchor, then plan how the episode builds toward it.
- Each encounter must feel like the episode's reason for existing — the culmination of everything that came before
- Plan what information/relationships/stakes the pre-encounter scenes must establish so the encounter choices feel loaded
- Design a DIFFICULTY CURVE across the season (introduction → rising → peak → falling → finale)
- Vary encounter types — no two consecutive episodes should use the same type
- Encounters at arc climaxes should be the hardest and most personally costly

In the `episodeEncounters` JSON, add an `encounterBuildup` field describing what the episode's earlier scenes need to establish for the encounter to land.

### 2. CROSS-EPISODE BRANCHING
Player choices should have consequences ACROSS episodes, not just within them.
- Identify 2-4 major branch points where player choices create DIFFERENT experiences in later episodes
- Encounter outcomes (victory/defeat/escape) are the richest source of cross-episode branches
- Branches should eventually reconverge (you can't make infinite parallel stories)

### 3. CONSEQUENCE CHAINS
Track how a single decision ripples through the season.
- A mercy shown in episode 2 might save you in episode 5
- An alliance formed in episode 1 might betray you in episode 4
- These create the feeling of a living, responsive world

Return this JSON:
{ ...full schema from `SeasonPlannerAgent.buildPlanningPrompt()`... }

CRITICAL RULES:
- Every episode MUST have at least 1 encounter — and it must be the episode's dramatic anchor
- Every encounter MUST have an encounterBuildup field describing what earlier scenes must establish
- Encounter types MUST VARY — no two consecutive episodes use the same type
- At least 2 cross-episode branches for a season with 3+ episodes (encounter outcomes are the best source)
- Consequence chains should span at least 2 episodes
- Difficulty should generally increase through the season
- You are NOT limited to what the source material literally contains — invent more dramatically intense encounters that fit the themes
- Return ONLY valid JSON
```

## Stage 1: World Building

### Agent

`WorldBuilder`

### System prompt addition

`WorldBuilder.getAgentSpecificPrompt()` is injected in full. It defines the World Builder role, emergent worldbuilding, environmental storytelling, consistent rule systems, sensory immersion, faction design, and consistency rules.

### User prompt

```text
Create a comprehensive world bible for the following story:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Synopsis**: ${input.storyContext.synopsis}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## World Foundation
- **Premise**: ${input.worldPremise}
- **Time Period**: ${input.timePeriod}
- **Technology Level**: ${input.technologyLevel}
${input.magicSystem ? `- **Magic System**: ${input.magicSystem}` : ''}

## Locations
${locationList}

## Established Lore (Must Maintain Consistency)
${existingLore}
${input.rawDocument ? `
## Original Source Document (Reference for Additional Context)
Use this document to extract any additional world details, locations, characters, or lore that might be helpful:

${input.rawDocument.substring(0, 3000)}${input.rawDocument.length > 3000 ? '\n... (truncated)' : ''}
` : ''}
## Requirements

Create a WorldBible JSON object. Keep descriptions CONCISE but evocative (1-2 sentences each, not paragraphs).

{
  "worldRules": ["rule 1", "rule 2"],
  "taboos": ["taboo 1"],
  "majorEvents": [{"name": "Event", "description": "brief", "yearsAgo": "50", "impact": "brief"}],
  "locations": [...],
  "factions": [...],
  "customs": ["custom 1"],
  "beliefs": ["belief 1"],
  "tensions": ["tension 1"],
  "doNotForget": ["fact 1"]
}

CRITICAL REQUIREMENTS:
1. ${locationInstructions}
2. Each location "fullDescription" must be 80-200 characters (2-3 sentences, NOT paragraphs)
3. Each location needs "sensoryDetails" with all 5 senses
4. Create exactly 3 locations and 2 factions (no more)
5. Keep ALL text concise - quality over quantity
6. IDs must be strings: "location-1", "faction-1", etc.

Respond with ONLY valid JSON, no markdown, no extra text.
```

### Retry prompt: missing locations

If requested locations are missing, the pipeline sends:

```text
You previously created a world bible but missed some locations. Please create ONLY these specific locations.

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## MISSING LOCATIONS TO CREATE (REQUIRED)
${locationList}

## CRITICAL: You MUST create ALL ${missingLocations.length} locations listed above.
Each location MUST have its "id" set to EXACTLY one of: ${locationIds}

Return ONLY a JSON object with a "locations" array containing these ${missingLocations.length} locations:
{ ...schema... }

IMPORTANT: Return EXACTLY ${missingLocations.length} locations with IDs matching: ${locationIds}
```

### Revision prompt: quality issues

If quality checks fail:

~~~text
You previously created a world bible, but there are quality issues that need improvement.

## Original World Bible
```json
${JSON.stringify(originalBible, null, 2)}
```

## Issues to Fix
${issueList}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## How to Fix
... location / faction / world-rule fix instructions ...

## Requirements
Return a REVISED WorldBible JSON that fixes all the issues above.
Keep all existing content but improve the flagged areas.
Return ONLY valid JSON, no markdown, no extra text.
~~~

## Stage 2: Character Design

### Agent

`CharacterDesigner`

### System prompt addition

`CharacterDesigner.getAgentSpecificPrompt()` is injected in full. It defines want/fear/flaw, voice distinction, relationship dynamics, voice-profile rules, sample dialogue requirements, and quality checks.

### User prompt

```text
Create character profiles for this story. Keep descriptions CONCISE (1-2 sentences each).

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## World Context
${input.worldContext}
${input.rawDocument ? `
## Original Source Document (Reference for Additional Context)
Use this to extract character details, personalities, relationships, or backstory mentioned in the original document:

${input.rawDocument.substring(0, 3000)}${input.rawDocument.length > 3000 ? '\n... (truncated)' : ''}
` : ''}${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Characters to Create (MUST use these exact IDs: ${characterIds})
${characterList}

## Required JSON Structure
{ ...schema from `CharacterDesigner.buildPrompt()`... }

CRITICAL REQUIREMENTS:
1. Each character "id" MUST be EXACTLY one of: ${characterIds}
2. Each character MUST have "pronouns" set to exactly one of: "he/him", "she/her", or "they/them"
3. Each character MUST have want, fear, and flaw filled in
4. Each voiceProfile MUST have at least 2 greetingExamples and 3 signatureLines
5. MUST include "voiceDistinctions" at the top level (not nested)
6. Keep ALL descriptions concise - one sentence each
7. Return ONLY valid JSON, no markdown, no extra text
```

### Revision prompt

If quality checks fail:

~~~text
You previously created a character bible, but there are quality issues that need improvement.

## Original Character Bible
```json
${JSON.stringify(originalBible, null, 2)}
```

## Issues to Fix
${issueList}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}

## How to Fix
... WANT/FEAR/FLAW, VOICE PROFILE, RELATIONSHIP, ARC POTENTIAL instructions ...

## Requirements
Return a REVISED CharacterBible JSON that fixes all the issues above.
Keep all existing content but improve the flagged areas.
Return ONLY valid JSON, no markdown, no extra text.
~~~

## Stage 3: Episode Architecture

### Agent

`StoryArchitect`

### System prompt addition

`StoryArchitect.getAgentSpecificPrompt()` is injected in full. It is encounter-first, branch-and-bottleneck, and choice-density oriented.

### User prompt

```text
Create an episode blueprint for the following story.

## DESIGN PROCESS — FOLLOW IN ORDER

**Before writing any scene, complete these steps mentally:**

1. **ENCOUNTER FIRST**: Identify the single most dramatically charged moment this episode can contain. This is your encounter. It goes into the blueprint as a scene with `isEncounter: true`. It is the episode's climax.
2. **WHAT DOES THE PLAYER NEED?** Before reaching the encounter, what must the player know, feel, and care about for the encounter's choices to hit hard? List the relationships, information, and emotional stakes the prior scenes must establish.
3. **DESIGN THE BUILDUP**: Create 2–4 scenes that escalate toward the encounter. Each one must earn its place by giving the player something they need for the encounter. Fill in `encounterBuildup` on every non-encounter scene.
4. **DESIGN THE AFTERMATH**: 1–2 scenes after the encounter that play out the consequences.
5. **THEN** write the full JSON blueprint.

Do NOT adapt the source material rigidly. Invent or heighten confrontations, crises, and conflicts to maximise drama. A quiet scene in the source can become an intense encounter if the themes support it.

## Story Context
- **Title**: ${input.storyTitle}
- **Genre**: ${input.genre}
- **Synopsis**: ${input.synopsis}
- **Tone**: ${input.tone}
${input.userPrompt ? `- **User Instructions/Prompt**: ${input.userPrompt}\n` : ''}

## Episode Details
- **Episode ${input.episodeNumber}**: "${input.episodeTitle}"
- **Episode Synopsis**: ${input.episodeSynopsis}
${input.previousEpisodeSummary ? `- **Previous Episode**: ${input.previousEpisodeSummary}` : ''}

## Characters
**Protagonist**: ${input.protagonistDescription}

**Available NPCs**:
${npcList}

## World Context
${input.worldContext}

**Current Location**: ${input.currentLocation}
${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Requirements
- Maximum scene count (cap): Up to ${input.targetSceneCount} scenes—generate fewer if the story doesn't need more
- Major choice points: ${input.majorChoiceCount} significant decisions
- Use branch-and-bottleneck structure
- Every major choice needs WANT, COST, and IDENTITY stakes
${this.buildSeasonPlanDirectivesSection(input)}

## Required JSON Structure
{ ...full schema from `StoryArchitect.buildPrompt()`... }

CRITICAL REQUIREMENTS:
... scene requirements, encounter requirements, choice density requirements, linking requirements ...

If you don't include enough choice points, the story will be rejected as non-interactive.
```

### Retry augmentation

If blueprint validation fails on choice density, `StoryArchitect.execute()` retries and appends this exact text to the original user prompt:

```text
⚠️ PREVIOUS ATTEMPT FAILED - ENSURE SUFFICIENT CHOICE POINTS:
- The first scene MUST have a choicePoint
- At least ${Math.ceil(input.targetSceneCount * 0.5)} out of up to ${input.targetSceneCount} scenes must have choicePoint
- Include choicePoint with type, stakes (want/cost/identity), and description for each choice scene
```

It also adds an assistant prefill:

```text
{"episodeId":
```

## Stage 3.5: Branch Analysis

### Agent

`BranchManager`

### System prompt addition

`BranchManager.getAgentSpecificPrompt()` is injected in full. It defines bottlenecks, reconvergence, state tracking, and branch validation responsibilities.

### User prompt

```text
Analyze the branch structure for the following episode:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## Episode
- **ID**: ${input.episodeId}
- **Title**: ${input.episodeTitle}
- **Starting Scene**: ${input.startingSceneId}
- **Bottleneck Scenes**: [${input.bottleneckScenes.join(', ')}]

## Scene Graph
${scenesList}

## Available State Variables
**Flags**:
${flagsList || 'None defined'}

**Scores**:
${scoresList || 'None defined'}

**Tags**:
${tagsList || 'None defined'}

## Required JSON Structure
{ ...schema from `BranchManager.buildPrompt()`... }

CRITICAL REQUIREMENTS:
1. Identify ALL distinct paths through the episode
2. Identify ALL reconvergence points where branches meet
3. Track ALL state changes and where they're used
4. Report ALL validation issues (dead ends, unreachable scenes, etc.)
5. Provide actionable recommendations
6. Return ONLY valid JSON, no markdown, no extra text
```

## Stage 4A: Scene Writing

### Agent

`SceneWriter`

### System prompt addition

`SceneWriter.getAgentSpecificPrompt()` is injected in full. It contains beat-size caps, text-variant rules, template-variable rules, choice-point enforcement, and the required visual contract for every beat.

Runtime enforcement note:

- the prompt still asks for up to `targetBeatCount` beats
- but the runtime now guards choice scenes after prompting so an underspecified one-beat response cannot silently collapse into only a choice beat plus generated payoff beats
- this protects downstream choice generation, image generation, and final assembly from degenerate scene shapes

### User prompt

```text
Write the scene content for the following scene blueprint:

${sourceContextStr}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **World**: ${input.storyContext.worldContext}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## Scene Blueprint
- **Scene ID**: ${input.sceneBlueprint.id}
- **Name**: ${input.sceneBlueprint.name}
- **Description**: ${input.sceneBlueprint.description}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}
- **Purpose**: ${input.sceneBlueprint.purpose}
- **Narrative Function**: ${input.sceneBlueprint.narrativeFunction}

### Expert Design Template
- **Dramatic Question**: ${input.sceneBlueprint.dramaticQuestion}
- **Want vs Need**: ${input.sceneBlueprint.wantVsNeed}
- **Conflict Engine**: ${input.sceneBlueprint.conflictEngine}

### Key Beats to Hit
${input.sceneBlueprint.keyBeats.map(b => `- ${b}`).join('\n')}

${input.sceneBlueprint.choicePoint ? `
### Choice Point
- **Type**: ${input.sceneBlueprint.choicePoint.type}
- **Description**: ${input.sceneBlueprint.choicePoint.description}
- **Stakes**:
  - Want: ${input.sceneBlueprint.choicePoint.stakes.want}
  - Cost: ${input.sceneBlueprint.choicePoint.stakes.cost}
  - Identity: ${input.sceneBlueprint.choicePoint.stakes.identity}
` : ''}

## Characters
... protagonist and scene NPC blocks ...

## Relevant State Context
${flagContext}

${input.episodeEncounterContext ? `
## ENCOUNTER BUILDUP (CRITICAL — This scene is building toward the episode's climax)
... encounter buildup block ...
` : ''}

## Requirements
- Write up to ${input.targetBeatCount} beats for this scene (cap—use fewer if the scene doesn't need more)
- ${input.dialogueHeavy ? 'This is dialogue-heavy - focus on conversation' : 'Balance description with any dialogue'}
${input.previousSceneSummary ? `- Previous scene context: ${input.previousSceneSummary}` : ''}
${input.sceneBlueprint.choicePoint ? '- Mark the final beat as isChoicePoint: true for the Choice Author to add options' : ''}
${input.incomingChoiceContext ? `
## CHOICE PAYOFF (CRITICAL — the player CHOSE this)
This scene is entered because the player chose: "${input.incomingChoiceContext}"
The FIRST beat MUST visually and textually pay off this choice. Do not delay, hedge, or skip the payoff.
... exact payoff instructions from `SceneWriter.buildPrompt()` ...
` : ''}

Create the scene content following the SceneContent schema. Include:
1. Engaging narrative prose for each beat
2. Distinct character voices in dialogue
3. Sensory details and atmosphere
4. Natural flow between beats
5. textVariants where state should affect content
6. Full beat visual contract fields (visualMoment, primaryAction, emotionalRead, relationshipDynamic, mustShowDetail) for every beat

Respond with valid JSON matching the SceneContent type.
```

### Revision prompt

If issues are found:

```text
You previously generated scene content that has some issues that need fixing.

## Original Content
${JSON.stringify(originalContent, null, 2)}

## Issues to Fix
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n\n')}

## Instructions
Please revise the content to fix these issues. Return the COMPLETE revised scene content as valid JSON.

Key requirements:
- Each beat must stay under cap: 4 sentences, ${TEXT_LIMITS.maxBeatWordCount} words (climax: ${TEXT_LIMITS.maxClimaxBeatWordCount}, key: ${TEXT_LIMITS.maxKeyStoryBeatWordCount})
- If a beat is too long, split it into multiple beats
- Maintain the narrative flow when splitting
- Keep beat IDs logical (beat-1, beat-2, etc.)
- Update nextBeatId references to maintain the chain
- If splitting the last beat, ensure the final beat has no nextBeatId (it ends the scene or leads to choices)

Return ONLY valid JSON matching the SceneContent schema.
```

## Stage 4B: Choice Authoring

### Agent

`ChoiceAuthor`

### System prompt addition

`ChoiceAuthor.getAgentSpecificPrompt()` is injected in full. It includes stakes triangle, choice geometry, five-factor test, choice-type rules, branching rules, identity conditions, delayed consequences, and formatting requirements.

### User prompt

```text
Create player choices for the following decision point:

${sourceContextStr}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## Scene Context
- **Scene**: ${input.sceneBlueprint.name}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}

## The Moment
This beat leads up to the choice:

"${input.beatText}"

## Choice Point Design
- **Type**: ${choicePoint.type}
- **Description**: ${choicePoint.description}
- **Stakes**:
  - Want: ${choicePoint.stakes.want}
  - Cost: ${choicePoint.stakes.cost}
  - Identity: ${choicePoint.stakes.identity}
- **Option Hints**: ${choicePoint.optionHints.join(', ')}

## Characters Present
... protagonist and NPCs ...

## Available Next Scenes
${nextSceneList}

## Available State for Consequences
**Flags**:
${flagList || 'None defined'}

**Scores**:
${scoreList || 'None defined'}

## Requirements
- Create ${input.optionCount} distinct choices
- Each choice must have the complete Stakes Triangle
- Include appropriate consequences for each choice
- Link choices to next scenes where appropriate
- Use conditions if any options should be locked

## Outcome Texts (REQUIRED for every choice)
... exact success / partial / failure instructions ...

## Reaction Text (REQUIRED for non-branching choices)
... exact reaction instructions ...

## Tint Flag (for non-branching choices)
... exact tint instructions ...

## Stat Check (REQUIRED for relationship, strategic, dilemma)
... exact stat-check rules ...

## Required JSON Structure
{ ...schema from `ChoiceAuthor.buildPrompt()`... }

CRITICAL REQUIREMENTS:
1. Create exactly ${input.optionCount} unique, meaningful choices
2. The "overallStakes" field is REQUIRED with want, cost, and identity filled in
3. Each choice needs stakesAnnotation with want, cost, and identity
4. Include appropriate consequences (flags, scores, relationships)
5. ${choicePoint.branches ? 'This is a BRANCHING choice point — set nextSceneId on each choice to one of the available next scenes' : 'Only include nextSceneId if this choice should route to a different scene (expression choices must NOT have nextSceneId)'}
6. Every choice MUST have outcomeTexts (success, partial, failure) — original prose, not the choice text
7. Non-branching choices MUST have reactionText and tintFlag
8. relationship/strategic/dilemma choices MUST have statCheck
9. Return ONLY valid JSON, no markdown, no extra text
```

### Revision prompt

If stakes/five-factor quality validation flags issues:

~~~text
You previously generated choices for a ${choicePoint.type} decision point, but there are quality issues that need to be fixed.

## Original Choice Set
```json
${JSON.stringify(originalChoiceSet, null, 2)}
```

## Issues to Fix
${issueList}

## How to Fix
... stakes and five-factor instructions ...

## Story Context
- **Scene**: ${input.sceneBlueprint.name}
- **Location**: ${input.sceneBlueprint.location}
- **Choice Type**: ${choicePoint.type}
- **Stakes**:
  - Want: ${choicePoint.stakes.want}
  - Cost: ${choicePoint.stakes.cost}
  - Identity: ${choicePoint.stakes.identity}

## Requirements
Return a REVISED ChoiceSet JSON that fixes all the issues above.
Keep the same basic structure but improve:
1. Stakes descriptions (want, cost, identity) - make them more specific and meaningful
2. Consequences - ensure they create real impact on the 5 factors
3. Choice text - ensure it reveals intent and character

Return ONLY valid JSON, no markdown, no extra text.
~~~

### Pipeline-triggered regeneration override

If incremental stakes validation fails after choice generation, the pipeline re-calls `ChoiceAuthor` and appends this exact sentence into `storyContext.userPrompt`:

```text
IMPORTANT - Fix these stakes issues: ${currentStakesResult.issues.map(i => i.issue).join('; ')}
```

## Stage 4C: Encounter Design

### Agent

`EncounterArchitect`

### System prompt addition

`EncounterArchitect.getAgentSpecificPrompt()` is injected in full. It is the most prescriptive system prompt in the narrative pipeline: branching-tree encounters, action→reaction flow, outcome-image logic, storylets, prior-state payoff, skill-driven branching, and Pixar-style odds-against rules.

### User prompt

The main prompt is `EncounterArchitect.buildPrompt(input)`. It includes:

- story context
- scene context
- encounter details
- protagonist and NPC canonical appearance blocks
- skills
- prior-state payoff context
- a very large required JSON schema
- strict branching-tree rules

Its opening text is:

```text
Design a COMPLETE encounter structure for the following scene:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.userPrompt ? `- **User Instructions**: ${input.storyContext.userPrompt}\n` : ''}

## Scene Context
- **Scene ID**: ${input.sceneId}
- **Scene Name**: ${input.sceneName}
- **Description**: ${input.sceneDescription}
- **Mood**: ${input.sceneMood}

## Encounter Details
- **Type**: ${input.encounterType}
- **Description**: ${input.encounterDescription}
- **Difficulty**: ${input.difficulty} (target ${difficultyOdds[input.difficulty]}% initial odds against player)
- **Target Beat Count**: ${input.targetBeatCount}
```

And its closing hard rules are:

```text
## CRITICAL REQUIREMENTS FOR BRANCHING TREES

1. **BRANCHING IS MANDATORY**: Each outcome (success/complicated/failure) MUST lead to a DIFFERENT nextSituation with DIFFERENT choices
2. **ACTION RESULT VISUALS**: The narrativeText and cinematicDescription show THE RESULT of the player's action (sword hitting/missing, plea accepted/rejected)
3. **DEPTH LIMIT**: Generate 2-3 layers of choices. Every situation at every depth MUST have at least 3 choices.
4. **NO nextBeatId**: Do NOT use nextBeatId. Use nextSituation with embedded choices instead.
5. **TERMINAL OUTCOMES**: When goal/threat clocks would fill, mark outcome as terminal with appropriate encounterOutcome
6. **CONSEQUENCES DIFFER**: Success branches should trend toward victory, failure branches toward defeat - but not linearly
7. **THREE-APPROACH MANDATE**: Each set of 3+ choices should cover distinct approaches — one aggressive/direct, one cautious/methodical, one clever/unconventional. This ensures the player always has meaningfully different paths, not just variations on the same tactic.
7. First beat choices MUST include `impliedApproach` field
8. ALL THREE STORYLETS (victory, defeat, escape) MUST be defined
9. Text length: setupText ~30-50 words, narrativeText ~30-60 words
10. Return ONLY valid JSON, no markdown
```

### Retry prompt: error feedback

Attempt 2 sends the original prompt, then an assistant message containing the prior failed output prefix, then this user message:

```text
Your previous response had a problem: ${lastError}

Please try again. Remember:
- The "beats" array MUST contain at least 2 beat objects
- Beat 1 should be a "setup" phase beat with choices
- Beat 2+ should progress toward a "resolution" phase with terminal outcomes
- Return ONLY valid JSON, no markdown code blocks, no prose before/after
- The entire response must be a single JSON object
```

### Retry prompt: simplified fallback

Final retry uses `buildSimplifiedPrompt(input)`, beginning with:

```text
Generate a SIMPLE 2-beat encounter for the following scene. This is a simplified request — focus on producing valid, complete JSON.

## Scene
- Scene ID: ${input.sceneId}
- Scene Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Type: ${input.encounterType}
- Difficulty: ${input.difficulty}
- Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
- Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})
- Key NPC: ${antagonist}
```

## Encounter Prompting Contract Notes

Prompting alone is no longer trusted to guarantee encounter image coverage.

After prompting:

- encounter image generation traverses the runtime encounter tree instead of assuming a flat `encounter.beats` array
- completeness checks recursively verify setup images, outcome images, nested next-situation images, and storylet aftermath images
- encounter image failures can now stop the pipeline instead of being logged and ignored

So the live contract is:

1. prompts must author a coherent encounter tree with durable visual contracts
2. runtime conversion must preserve that tree into `phases[].beats`
3. image generation and completeness gates validate the converted runtime tree, not just the authored source object

## Stage 4.5: Quick Validation

`IntegratedBestPracticesValidator.runQuickValidation()` is mostly heuristic.

LLM prompts are **not** used here.

Quick validation checks:

- NPC depth
- stakes presence
- five-factor heuristic
- choice density

## Stage 5A: Best-Practices Validation

### LLM-backed validators

- `StakesTriangleValidator`
- `FiveFactorValidator`

### StakesTriangleValidator system prompt

```text
You are an expert interactive fiction analyst evaluating choice stakes quality.

${STAKES_TRIANGLE}

Evaluate each component of the Stakes Triangle on a scale of 0-100:
- 0-30: Missing or extremely weak
- 31-60: Present but unclear or generic
- 61-80: Good, specific, engaging
- 81-100: Excellent, memorable, perfectly crafted

Always respond with valid JSON matching the required schema.
```

### StakesTriangleValidator user prompt

```text
Analyze the stakes quality for this ${input.choiceType} choice:

**Choice Text**: "${input.choiceText}"

**Stated Stakes**:
- WANT: ${input.want || '(not provided)'}
- COST: ${input.cost || '(not provided)'}
- IDENTITY: ${input.identity || '(not provided)'}

**Context**: ${input.context}

Respond with JSON:
{
  "wantScore": <0-100>,
  "wantAnalysis": "<brief analysis of the WANT component>",
  "costScore": <0-100>,
  "costAnalysis": "<brief analysis of the COST component>",
  "identityScore": <0-100>,
  "identityAnalysis": "<brief analysis of the IDENTITY component>",
  "overallAssessment": "<1-2 sentence overall assessment>",
  "suggestions": ["<improvement suggestion 1>", "<improvement suggestion 2>"]
}
```

### FiveFactorValidator system prompt

```text
You are an expert interactive fiction analyst evaluating choice impact across five factors.

## Five-Factor Test

Every meaningful choice should affect at least one of these factors:

1. **OUTCOME**: Does this choice change WHAT happens in the story?
   - Different scenes, events, or endings
   - Changed character fates
   - Different story beats

2. **PROCESS**: Does this choice change HOW things happen?
   - Different approaches to problems
   - Changed difficulty or method
   - Alternative paths to same goal

3. **INFORMATION**: Does this choice change what the player LEARNS?
   - Revealed secrets or lore
   - Character backstory
   - World information

4. **RELATIONSHIP**: Does this choice change character BONDS?
   - Trust, affection, respect, fear with NPCs
   - Alliance formations
   - Betrayals or loyalty

5. **IDENTITY**: Does this choice change WHO the protagonist is becoming?
   - Character development
   - Moral alignment
   - Personality expression

Analyze each factor and determine if the choice meaningfully affects it.
Always respond with valid JSON.
```

### FiveFactorValidator user prompt

```text
Analyze the five-factor impact for this ${input.choiceType} choice:

**Choice Text**: "${input.choiceText}"

**Explicit Consequences**:
${consequenceSummary}

**Context**: ${input.context}

For each factor, determine if this choice meaningfully affects it.
A choice can have implicit impact even without explicit consequences.

Respond with JSON:
{
  "outcome": { "affected": true/false, "explanation": "<why>" },
  "process": { "affected": true/false, "explanation": "<why>" },
  "information": { "affected": true/false, "explanation": "<why>" },
  "relationship": { "affected": true/false, "explanation": "<why>" },
  "identity": { "affected": true/false, "explanation": "<why>" },
  "overallAssessment": "<summary>",
  "suggestions": ["<how to increase impact>"]
}
```

## Stage 5B: QA Runner

### Important implementation detail

`ContinuityChecker`, `VoiceValidator`, and `StakesAnalyzer` define `getAgentSpecificPrompt()`, but they do **not** set `includeSystemPrompt = true`.

That means their current runtime LLM calls send:

- **no injected BaseAgent system prompt**
- **no shared storytelling prompt**
- **only the user prompt built in `buildPrompt()`**

This is important if you are trying to reason about actual prompts-on-the-wire versus intended prompts.

### ContinuityChecker user prompt

```text
Check the following content for continuity issues:

## Scene Content
${scenesSummary}

## Known State
### Flags
${flagsList || 'None defined'}

### Established Facts
${factsList || 'None established'}

### Character Knowledge
${...}

## Timeline
${...}

## Your Task

Analyze this content for:
1. Contradictions between scenes or within scenes
2. Characters knowing things they shouldn't
3. Timeline impossibilities
4. State references without proper setup
5. Missing cause-effect relationships

Provide a ContinuityReport with:
- Overall consistency score (0-100)
- All issues found with severity, location, and suggested fixes
- List of passed checks (things you verified are consistent)
- Recommendations for improving consistency

Respond with valid JSON matching the ContinuityReport type.
```

### VoiceValidator user prompt

```text
Validate character voices in the following content:

## Character Voice Profiles
${profileSummary}

## Dialogue to Validate
${dialogueSummary}

## Your Task

For each character with dialogue:
1. Compare their lines to their voice profile
2. Check for vocabulary, tic, and formality consistency
3. Identify any lines that sound "off"
4. Score overall voice consistency

Also evaluate:
- How distinct are the characters from each other?
- Could you identify speakers without tags?
- Are there any voice "collisions"?

Provide a VoiceReport with:
- Overall voice quality score
- Per-character scores with strengths and weaknesses
- Specific issues with suggested corrections
- Voice distinction score
- Recommendations for improvement

Respond with valid JSON matching the VoiceReport type.
```

### StakesAnalyzer user prompt

```text
Analyze the stakes and quality of the following choices:

## Story Context
- **Themes**: ${input.storyThemes.join(', ')}
- **Target Tone**: ${input.targetTone}

## Scene Context
${sceneContext}

## Choices to Analyze
${choicesSummary}

## Your Task

For each choice set:
1. Evaluate the Stakes Triangle (Want, Cost, Identity)
2. Check for false choices or obvious "right answers"
3. Assess whether stakes match the choice type
4. Score overall choice quality

Also evaluate:
- Stakes progression through the episode
- Variety of choice types
- Quality of any moral dilemmas
- Overall engagement potential

Provide a StakesReport with:
- Overall stakes score
- Per-choice-set detailed analysis
- Aggregate metrics (false choices, dilemma quality, variety)
- Specific issues with suggestions
- Strengths to maintain
- Recommendations for improvement

Respond with valid JSON matching the StakesReport type.
```

## Non-LLM Narrative Checks

These stages do not send prompts to an LLM:

- `NPCDepthValidator`
- `ChoiceDensityValidator`
- `CallbackOpportunitiesValidator`
- incremental voice validator
- incremental sensitivity checker
- incremental continuity checker
- incremental encounter validation

## Story-Adjacent Agents Not On The Main Narrative Prompt Path

These agents exist but are not part of the main `worker-runner → FullStoryPipeline` narrative text-generation path documented above:

- `SeasonArchitect` — season-level arc planning (alternative to `SeasonPlannerAgent`)
- `DialogueSpecialist` — dialogue variant generation per relationship state
- `ResolutionDesigner` — stat check calibration
- `BeatWriter` — beat-level content generation (alternative to `SceneWriter`)
- `ScriptCompiler` — final script assembly
- `PlaytestSimulator` — automated playtest simulation
- `VariableTracker` — state variable tracking across scenes

### Image and Video Agents (Separate Prompt Paths)

These agents have their own prompt assembly logic documented in `docs/IMAGE_PIPELINE_RUNTIME.md`:

- `ImageAgentTeam` — orchestrator for all image generation
- `StoryboardAgent` — shot rhythm and visual planning
- `VisualIllustratorAgent` — beat illustration prompts
- `EncounterImageAgent` — cinematic encounter image prompts
- `CharacterReferenceSheetAgent` — character reference/expression sheets
- `ColorScriptAgent` — color script and thumbnail generation
- `VideoDirectorAgent` — video direction for Veo pipeline
- `ConsistencyScorerAgent` — image/reference consistency scoring
- `DramaExtractionAgent` — dramatic structure extraction for images
- Various QA validators: `CompositionValidatorAgent`, `TransitionValidator`, `PoseDiversityValidator`, `ExpressionValidator`, `BodyLanguageValidator`, `LightingColorValidator`, `VisualNarrativeValidator`, `VisualStorytellingValidator`, `AssetAuditorAgent`

## PartialVictory Cost Prompting

`partialVictory` is now prompted as `objective achieved, but price visible`, not just a bittersweet label.

- `SceneBlueprint.encounterPartialVictoryCost` can seed the intended domain, severity, payer, immediate effect, and visible complication.
- `EncounterArchitect` can author `cost` on terminal partial-victory outcomes and on the partial-victory storylet itself.
- `encounterConverter` migrates older prose-only partial victories into a structured fallback cost so already-generated stories remain usable.
- Encounter visual contracts should include `visibleCost` whenever the outcome is `partialVictory`, so image prompts can differentiate it from clean victory.
