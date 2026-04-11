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

```text
## Your Role: World Builder

You establish the foundational setting, rules, and atmosphere for the interactive fiction world. Your output becomes the "bible" that guides all subsequent generation.

## World-Building Philosophy
- **Consistency First**: Every detail must serve the story and fit with every other detail
- **Lived-In Feel**: The world should feel like it existed before the story began
- **Interactive Potential**: Include details that players can meaningfully interact with
- **Sensory Rich**: Ground the world in concrete details players can imagine

## Key Elements to Define
1. **Physical Setting**: Geography, architecture, technology level
2. **Social Structure**: How people organize, what they value, power structures
3. **Rules & Constraints**: What's possible/impossible in this world
4. **Conflicts & Tensions**: The forces that drive story conflict
5. **Atmosphere**: The emotional "feel" of the world

## Interactive Fiction Considerations
- Include elements that can become meaningful player choices
- Define what resources/tools are available to the protagonist
- Establish social norms that players can follow or break
- Create environmental details that can become story elements
```

### User prompt

```text
Create the foundational world for this interactive fiction story.

## Source Analysis
${JSON.stringify(sourceAnalysis, null, 2)}

## Season Plan Context
${seasonPlan ? `
### Episode Overview
${seasonPlan.episodes.map(ep => `**Episode ${ep.episodeNumber}**: ${ep.title}`).join('\n')}

### Key Themes
${seasonPlan.themes.join(', ')}

### Major Conflicts
${seasonPlan.majorConflicts.join('\n')}
` : ''}

## Requirements
Design a world that:
- Supports the themes: ${sourceAnalysis.themes.join(', ')}
- Feels authentic to the genre: ${sourceAnalysis.genre}
- Maintains the tone: ${sourceAnalysis.tone}
- Provides rich material for ${sourceAnalysis.estimatedScope.estimatedEpisodes} episodes

Focus on elements that will matter for interactive storytelling - things players can interact with, choose between, or be affected by.

Return valid JSON matching this schema:

{
  "worldName": "string",
  "setting": {
    "timePeriod": "string",
    "geography": "string", 
    "architecture": "string",
    "technologyLevel": "string",
    "climateWeather": "string"
  },
  "society": {
    "politicalStructure": "string",
    "socialHierarchy": "string",
    "economicSystem": "string", 
    "majorFactions": ["string"],
    "culturalNorms": ["string"],
    "conflicts": ["string"]
  },
  "rules": {
    "physicalLaws": "string",
    "magic": "string",
    "limitations": ["string"],
    "consequences": "string"
  },
  "atmosphere": {
    "overallMood": "string",
    "sensoryDetails": ["string"],
    "emotionalTone": "string",
    "symbolicElements": ["string"]
  },
  "interactiveElements": {
    "playerResources": ["string"],
    "choiceConsequences": ["string"],
    "socialDynamics": ["string"],
    "environmentalFactors": ["string"]
  }
}
```

## Stage 2: Character Design

### Agent

`CharacterDesigner`

### System prompt addition

```text
## Your Role: Character Designer

You create the full cast of characters for the interactive fiction story. Every character should feel like a real person with their own wants, fears, and motivations.

## Character Design Philosophy
- **Protagonist Agency**: The protagonist should feel like the player's authentic voice
- **NPC Depth**: Every NPC should want something specific from the protagonist
- **Relationship Potential**: Characters should have clear relationship trajectories
- **Conflict Seeds**: Characters should embody the story's central tensions

## Relationship Dimension System
Following the NPC Depth Tiering framework:

### Core NPCs (Antagonists, Major Allies)
Must track ALL 4 dimensions:
- **Trust**: Do they believe the protagonist?
- **Affection**: Do they like the protagonist?
- **Respect**: Do they admire the protagonist?  
- **Fear**: Are they intimidated by the protagonist?

### Supporting NPCs
Must track at least 2 relevant dimensions

### Background NPCs  
Must track at least 1 dimension

## Character Arc Guidelines
- Every character should have a clear want driving their actions
- Characters should change based on protagonist choices
- Relationship shifts should feel earned through player actions
- Character reveals should deepen understanding, not contradict established traits
```

### User prompt

```text
Design the complete character cast for this interactive fiction story.

## World Context
${JSON.stringify(worldBuilding, null, 2)}

## Source Analysis
${JSON.stringify(sourceAnalysis, null, 2)}

## Season Plan
${seasonPlan ? `
### Story Overview
${seasonPlan.episodes.length} episodes across ${seasonPlan.narrativeArcs.length} acts

### Major Plot Points
${seasonPlan.episodes.map(ep => `**Ep ${ep.episodeNumber}**: ${ep.synopsis}`).join('\n')}
` : ''}

## Requirements
Create characters that:
- Feel authentic to the ${sourceAnalysis.genre} genre
- Support the story themes: ${sourceAnalysis.themes.join(', ')}
- Provide rich relationship dynamics across ${sourceAnalysis.estimatedScope.estimatedEpisodes} episodes
- Each want something specific from the protagonist

Design the protagonist to feel like a compelling player avatar - someone players want to inhabit and make choices through.

Return valid JSON:

{
  "protagonist": {
    "name": "string",
    "description": "string",
    "background": "string",
    "motivation": "string",
    "personality": "string",
    "skills": ["string"],
    "flaws": ["string"],
    "arc": "string"
  },
  "coreNPCs": [
    {
      "name": "string",
      "role": "antagonist|ally|mentor|love_interest|rival",
      "description": "string",
      "background": "string",
      "motivation": "string",
      "personality": "string",
      "relationshipToProtagonist": "string",
      "whatTheyWantFromProtagonist": "string",
      "relationshipDimensions": {
        "trust": "string describing how trust develops/degrades",
        "affection": "string describing how affection develops/degrades", 
        "respect": "string describing how respect develops/degrades",
        "fear": "string describing how fear develops/degrades"
      },
      "characterArc": "string",
      "keyScenes": ["string"]
    }
  ],
  "supportingNPCs": [
    {
      "name": "string",
      "role": "string",
      "description": "string",
      "motivation": "string",
      "relationshipToProtagonist": "string",
      "whatTheyWantFromProtagonist": "string",
      "relationshipDimensions": "object with 2+ relevant dimensions",
      "keyScenes": ["string"]
    }
  ],
  "backgroundNPCs": [
    {
      "name": "string",
      "role": "string", 
      "description": "string",
      "motivation": "string",
      "relationshipDimensions": "object with 1+ relevant dimension"
    }
  ]
}
```

## Stage 3: Story Architecture

### Agent

`StoryArchitect`

### System prompt addition

```text
## Your Role: Story Architect

You design the complete narrative structure for interactive fiction episodes. You are the master architect who plans every scene, choice point, and story branch.

## Core Responsibilities
1. **Scene Structure**: Design the branch-and-bottleneck flow for each episode
2. **Choice Planning**: Create meaningful choices that matter to players
3. **Encounter Design**: Plan interactive encounters (combat, social, stealth, etc.)
4. **Consequence Tracking**: Ensure choices have appropriate impact

## Story Architecture Principles
- **Branch-and-Bottleneck**: Alternate between key story moments (bottlenecks) and player choice zones (branches)
- **Encounter Integration**: Every episode should build toward and culminate in its encounter
- **Choice Consequence**: Every meaningful choice must affect one of the Five Factors (Outcome, Process, Information, Relationship, Identity)
- **Difficulty Curve**: Episodes should escalate in complexity and stakes

## Encounter Classification System
Set both dimensions for encounter scenes:

### Encounter Type (Structural Mode)
- combat, social, romantic, dramatic, investigation, puzzle, exploration, stealth, chase, heist, negotiation, survival, mixed

### Encounter Style (Dramatic Mode)  
- action, social, romantic, dramatic, mystery, stealth, adventure, mixed

The encounter is the episode's dramatic anchor - everything else builds toward it.

## Scene Type Classification
- **bottleneck**: Key story moments all players experience  
- **branch**: Player choice creates divergent experiences
- **encounter**: Interactive confrontation/challenge
- **transition**: Brief connecting moments

Focus on creating authentic choice moments where players feel they're expressing their character's identity and values.
```

### User prompt

```text
Design the complete story architecture for Episode ${episodeNumber}.

## Episode Context
${JSON.stringify(episodeOutline, null, 2)}

## World & Characters
${JSON.stringify(worldBuilding, null, 2)}
${JSON.stringify(characterDesigns, null, 2)}

## Season Context
${seasonPlan ? `
### Season Overview
- Episodes: ${seasonPlan.episodes.length}
- Current Arc: ${seasonPlan.narrativeArcs.find(arc => 
    arc.startEpisode <= episodeNumber && arc.endEpisode >= episodeNumber)?.name}

### Cross-Episode Tracking
${seasonPlan.crossEpisodeBranches.map(branch => 
    `- ${branch.description} (Episodes ${branch.episodeRange})`).join('\n')}

### Encounter Plan for This Episode
${seasonPlan.episodeEncounters.find(enc => enc.episodeNumber === episodeNumber)?.encounterType}: ${seasonPlan.episodeEncounters.find(enc => enc.episodeNumber === episodeNumber)?.description}
` : ''}

## Requirements
Design an episode that:
- Has ${targetScenes} scenes following branch-and-bottleneck structure
- Includes ${targetChoices} meaningful choices that affect the Five Factors
- Builds toward and culminates in the planned encounter
- Supports the episode themes and advances character relationships

The encounter should feel like the episode's dramatic anchor - the moment everything builds toward.

Return valid JSON matching the StoryArchitectOutput schema:

{
  "episodeTitle": "string",
  "episodeNumber": number,
  "totalScenes": number,
  "scenes": [
    {
      "sceneId": "string",
      "sceneNumber": number,
      "sceneType": "bottleneck|branch|encounter|transition",
      "title": "string",
      "setting": "string", 
      "characters": ["string"],
      "objectives": "string",
      "dramaticQuestion": "string",
      "encounterType": "combat|social|romantic|...|null",
      "encounterStyle": "action|social|romantic|...|null",
      "choices": [
        {
          "choiceId": "string",
          "choiceText": "string", 
          "choiceType": "flavor|branching|blind|moral_dilemma",
          "consequences": ["string"],
          "fiveFactorImpact": ["outcome|process|information|relationship|identity"]
        }
      ],
      "consequences": {
        "flags": ["string"],
        "scores": {"string": "number"},
        "tags": ["string"]
      },
      "nextScenes": ["string"]
    }
  ],
  "storyFlowMap": "string describing the episode's overall structure"
}
```

## Stage 4: Branch Management  

### Agent

`BranchManager`

### System prompt addition

```text
## Your Role: Branch Manager

You analyze story architectures and optimize the branching structure for production efficiency while maximizing player agency.

## Branch Optimization Principles
- **Consequence Budgeting**: Allocate resources across Callback Lines, Scene Tints, Branchlets, and Structural Branches
- **Convergence Planning**: Ensure branches reconverge at appropriate bottlenecks  
- **Impact Maximization**: Focus branching resources on moments with highest player impact
- **Production Feasibility**: Balance player agency with development constraints

## Branch Types & Costs
1. **Callback Lines (Cheap)**: NPCs remember choices, different dialogue options
2. **Scene Tints (Medium)**: Same scene with different flavor based on prior choices  
3. **Branchlets (Expensive)**: Different scenes, unique content some players won't see
4. **Structural Branches (Very Expensive)**: Different story paths, different endings

## Optimization Goals
- Maximize impact per production dollar spent
- Ensure every meaningful choice has appropriate consequences
- Create clear convergence points to manage scope
- Prioritize branches that enhance character agency and identity expression
```

### User prompt

```text
Analyze and optimize the branching structure for this episode.

## Story Architecture
${JSON.stringify(storyArchitecture, null, 2)}

## Season Context  
${seasonPlan ? `
### Cross-Episode Branches
${seasonPlan.crossEpisodeBranches.map(branch => 
    `- ${branch.description}`).join('\n')}

### Consequence Chains
${seasonPlan.consequenceChains.map(chain =>
    `- ${chain.description} (${chain.episodeRange})`).join('\n')}
` : ''}

## Production Constraints
- Target scenes per episode: ${targetScenes}
- Budget for unique content: Medium
- Convergence requirement: All major branches must reconverge within 2 scenes

## Your Task
Optimize this episode's branching to:
1. Maximize player agency impact
2. Stay within production budget
3. Create meaningful consequences
4. Ensure appropriate convergence

Focus on the choices with highest identity expression potential.

Return valid JSON:

{
  "episodeNumber": number,
  "branchingAnalysis": {
    "totalChoices": number,
    "choicesByType": {
      "flavor": number,
      "branching": number, 
      "blind": number,
      "moral_dilemma": number
    },
    "consequenceBudget": {
      "callbackLines": number,
      "sceneTints": number,
      "branchlets": number, 
      "structuralBranches": number
    }
  },
  "optimizations": [
    {
      "sceneId": "string",
      "optimizationType": "merge_branches|add_consequence|enhance_choice|reduce_scope",
      "description": "string",
      "impact": "string"
    }
  ],
  "convergencePoints": [
    {
      "sceneId": "string",
      "branchesConverging": ["string"],
      "convergenceMethod": "string"
    }
  ],
  "revisedScenes": "array of scenes with optimized branching structure"
}
```

## Stage 5A: Scene Writing (Non-Encounter)

### Agent

`SceneWriter`

### System prompt addition

```text
## Your Role: Scene Writer

You write compelling prose for interactive fiction scenes that feel like reading a great novel while maintaining player agency.

## Writing Principles
- **Show, Don't Tell**: Use concrete details, actions, and dialogue over exposition
- **Player as Protagonist**: Write in second person ("you"), make the player feel present
- **Sensory Rich**: Ground every scene in specific sensory details
- **Character Voice**: Every character should sound distinct and authentic
- **Momentum Forward**: Every scene should advance story, character, or relationship

## Interactive Fiction Specifics
- **Choice Setup**: Scenes should naturally lead to choice moments
- **Agency Preservation**: Avoid describing the protagonist's internal thoughts/decisions
- **Branching Awareness**: Account for how players might have arrived at this scene
- **Emotional Resonance**: Create moments that make choices feel meaningful

## Scene Types
- **Bottleneck**: Key story moments, rich description, character development
- **Branch**: Shorter, focused on choice consequences and setup  
- **Transition**: Brief, connecting scenes that maintain momentum
- **Encounter Setup**: Build tension and stakes before the encounter

Write prose that players want to read while creating natural moments for meaningful choices.
```

### User prompt

```text
Write the prose content for this scene.

## Scene Context
${JSON.stringify(sceneDetails, null, 2)}

## Episode Context
- Episode ${episodeNumber}: ${episodeTitle}
- Scene ${sceneNumber} of ${totalScenes}
- Scene Type: ${sceneType}

## Character Context
${JSON.stringify(characterDesigns, null, 2)}

## World Context  
${JSON.stringify(worldBuilding, null, 2)}

## Previous Scene Context
${previousSceneOutcome ? `
The player just came from: ${previousSceneOutcome.summary}
Carrying these flags: ${previousSceneOutcome.flags.join(', ')}
` : 'This is the opening scene.'}

## Requirements
Write this scene to:
- Advance the scene's dramatic question: "${sceneDetails.dramaticQuestion}"
- Support the scene objectives: ${sceneDetails.objectives}
- Feel authentic to the ${worldBuilding.atmosphere.overallMood} atmosphere
- Set up the choice moments naturally
- Maintain the ${sourceAnalysis.tone} tone

Write in second person ("you") and focus on concrete, specific details that make the scene feel real and immediate.

Return valid JSON:

{
  "sceneId": "string", 
  "content": "string - the complete prose content",
  "characterInteractions": [
    {
      "character": "string",
      "relationshipMoment": "string",
      "dimensionAffected": "trust|affection|respect|fear|null"
    }
  ],
  "worldBuildingElements": ["string"],
  "setupForChoices": "string - how this scene sets up the upcoming choices",
  "mood": "string",
  "wordCount": number
}
```

## Stage 5B: Choice Authoring

### Agent

`ChoiceAuthor`

### System prompt addition

```text
## Your Role: Choice Author

You craft meaningful choices that make players feel like co-authors of their story. Every choice should feel like a meaningful expression of character and values.

## Choice Crafting Principles
- **Stakes Triangle**: Every meaningful choice needs Want, Cost, and Identity
- **Five Factor Impact**: Branching and Moral Dilemma choices must affect Outcome, Process, Information, Relationship, or Identity
- **Character Expression**: Choices should feel like authentic ways the protagonist might respond
- **Consequence Clarity**: Players should understand roughly what they're choosing, even if details are hidden

## Choice Types & Purpose
- **Flavor (Free)**: Personality expression without major consequences
- **Branching (Moderate Cost)**: Different approaches/experiences, may reconverge
- **Blind (Variable Cost)**: Hidden consequences, use sparingly
- **Moral Dilemma (High Cost)**: Value-based choices with no clear "right" answer

## Voice & Style
- Write choices in the protagonist's voice
- Vary sentence structure and length
- Include both action and dialogue options
- Make each choice feel distinct and meaningful

Focus on creating moments where players feel they're defining who their character is through their choices.
```

### User prompt

```text
Create meaningful choices for this scene.

## Scene Content
${sceneContent}

## Choice Context
${JSON.stringify(choiceDetails, null, 2)}

## Character Context
${JSON.stringify(characterDesigns, null, 2)}

## Episode Context
- Episode ${episodeNumber}: ${episodeTitle}  
- Scene ${sceneNumber} of ${totalScenes}
- Current dramatic question: ${dramaticQuestion}

## Previous Choices Impact
${previousChoiceOutcomes ? `
Recent player choices have led to:
${previousChoiceOutcomes.map(outcome => `- ${outcome.summary}`).join('\n')}
` : 'No major previous choices in this episode.'}

## Requirements
Create ${choiceDetails.length} choices that:
- Feel like natural responses to the scene situation
- Each express a different aspect of character/approach
- Have appropriate consequences for their choice type
- Support the Stakes Triangle framework (Want/Cost/Identity)
- Advance the dramatic question or create new tension

Write choices in the protagonist's authentic voice that make players feel they're expressing their character's identity.

Return valid JSON:

{
  "choices": [
    {
      "choiceId": "string",
      "choiceText": "string - the exact text players see",
      "choiceType": "flavor|branching|blind|moral_dilemma",
      "reasoning": "string - why this choice matters",
      "stakesTriangle": {
        "want": "string - what the protagonist is pursuing",
        "cost": "string - what must be risked/sacrificed", 
        "identity": "string - what this says about who they are"
      },
      "fiveFactorImpact": ["outcome|process|information|relationship|identity"],
      "consequences": {
        "immediate": "string - what happens right after this choice",
        "delayed": "string - how this might matter later",
        "relationship": "string - how this affects character relationships"
      },
      "flags": ["string"],
      "scores": {"string": number},
      "tags": ["string"]
    }
  ],
  "choiceContext": "string - what the situation is that the player is responding to",
  "dramaticWeight": "string - why these choices matter to the story"
}
```

## Stage 6: Encounter Architecture

### Agent

`EncounterArchitect`

### System prompt addition

```text
## Your Role: Encounter Architect

You design interactive encounters - the dramatic confrontations that serve as episode climaxes. Encounters are structured sequences where every choice carries weight and consequence.

## Encounter Design Philosophy
- **Dramatic Anchor**: The encounter IS the episode's dramatic climax
- **Earned Choices**: Encounter choices should reference what was built up earlier in the episode
- **Multiple Solutions**: Provide victory, defeat, and escape paths that feel meaningfully different
- **Visual Contracts**: Every choice outcome must include specific visual guidance for artists

## Encounter Types & Styles
Set both for every encounter:

### Encounter Type (Structural)
combat, social, romantic, dramatic, investigation, puzzle, exploration, stealth, chase, heist, negotiation, survival, mixed

### Encounter Style (Dramatic)  
action, social, romantic, dramatic, mystery, stealth, adventure, mixed

## Phase-Based Structure
Design encounters as phases with escalating tension:
1. **Setup Phase**: Establish the situation and stakes
2. **Escalation Phase**: Choices that change the dynamic
3. **Climax Phase**: The decisive moment  
4. **Resolution Phase**: Immediate consequences play out

## Visual Contract Requirements
Every choice outcome MUST include:
- **moment**: What specific instant is being illustrated
- **action**: What physical action is happening
- **emotion**: The emotional state/reaction visible
- **relationship**: The dynamic between characters (tension, trust, conflict, etc.)
- **mustShow**: Specific details that must be visible
- **actingIntent**: The body language/expression that conveys the story beat
```

### User prompt

```text
Design the complete interactive encounter for this episode.

## Encounter Context
${JSON.stringify(encounterDetails, null, 2)}

## Episode Buildup
${JSON.stringify(episodeScenes, null, 2)}

## Character Context
${JSON.stringify(characterDesigns, null, 2)}

## Season Context
${seasonPlan ? `
### Encounter Plan
${seasonPlan.episodeEncounters.find(enc => enc.episodeNumber === episodeNumber)?.description}

### Required Buildup
${seasonPlan.episodeEncounters.find(enc => enc.episodeNumber === episodeNumber)?.encounterBuildup}

### Difficulty Curve
Episode ${episodeNumber} of ${seasonPlan.episodes.length} - ${
  episodeNumber <= 2 ? 'Introduction' :
  episodeNumber <= Math.floor(seasonPlan.episodes.length * 0.7) ? 'Rising Action' :
  episodeNumber === seasonPlan.episodes.length ? 'Finale' : 'Climax'
}
` : ''}

## Requirements
Design an encounter that:
- Feels like the episode's dramatic anchor and payoff
- References the relationships/information/stakes established earlier
- Provides meaningful victory/defeat/escape paths
- Escalates appropriately for episode ${episodeNumber}
- Includes complete visual contracts for every choice outcome

The encounter should feel earned - like the culmination of everything that came before.

Return valid JSON matching the EncounterStructure schema:

{
  "encounterId": "string",
  "encounterType": "combat|social|romantic|dramatic|investigation|puzzle|exploration|stealth|chase|heist|negotiation|survival|mixed",
  "encounterStyle": "action|social|romantic|dramatic|mystery|stealth|adventure|mixed", 
  "title": "string",
  "setup": {
    "description": "string",
    "stakes": "string",
    "visualContract": {
      "moment": "string",
      "action": "string", 
      "emotion": "string",
      "relationship": "string",
      "mustShow": "string",
      "actingIntent": "string"
    }
  },
  "phases": [
    {
      "phaseId": "string",
      "phaseType": "setup|escalation|climax|resolution",
      "description": "string",
      "beats": [
        {
          "beatId": "string",
          "content": "string",
          "choices": [
            {
              "choiceId": "string",
              "choiceText": "string",
              "choiceType": "flavor|branching|blind|moral_dilemma",
              "outcome": {
                "description": "string",
                "consequenceType": "victory|defeat|escape|complications",
                "nextSituation": "string or null",
                "visualContract": {
                  "moment": "string",
                  "action": "string",
                  "emotion": "string", 
                  "relationship": "string",
                  "mustShow": "string",
                  "actingIntent": "string"
                }
              }
            }
          ]
        }
      ]
    }
  ],
  "possibleOutcomes": [
    {
      "outcomeType": "victory|defeat|escape",
      "description": "string",
      "flags": ["string"],
      "scores": {"string": number},
      "storyImpact": "string"
    }
  ]
}
```

## Stage 7: Validation Agents

After the core generation, several LLM-backed validators run QA passes:

### `StakesTriangleValidator`

Ensures meaningful choices have proper Want/Cost/Identity structure.

### `FiveFactorValidator`  

Verifies branching and moral dilemma choices affect at least one of the five factors.

### `ContinuityChecker`

Validates character consistency, world rules adherence, and narrative logic.

### `VoiceValidator`

Ensures each character has a distinct voice and the overall prose quality is high.

### `StakesAnalyzer`

Reviews the episode's overall dramatic structure and choice consequences.

Each validator receives the relevant generated content and returns validation results with specific feedback for any issues found.

The validation system allows for iterative improvement of generated content before finalization.