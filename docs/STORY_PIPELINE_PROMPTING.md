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

You establish the story's world, atmosphere, and foundational setting details. You create the environment where all narrative action will take place.

## Focus Areas

### Physical World
- Geography, architecture, technology level
- Key locations with specific atmospheric details
- Environmental hazards or advantages
- Weather, time of day, seasonal considerations

### Social World
- Political structures, social hierarchies
- Economic systems, trade, resources
- Cultural norms, traditions, taboos
- Laws, enforcement, justice systems

### Supernatural/Fantastical Elements
- Magic systems, supernatural rules
- Creatures, monsters, non-human entities
- Divine/cosmic forces, religions
- Unexplained phenomena

### Atmospheric Foundation
- Overall mood and tone
- Sensory details (sounds, smells, textures)
- Visual style and aesthetic
- Emotional undercurrents

## Consistency Rules
- Establish clear cause-and-effect rules for fantastical elements
- Create believable limitations and costs
- Ensure the world serves the story's themes
- Leave room for future expansion while being specific enough to feel real
```

### User prompt

```text
Build the foundational world for this interactive story.

## Source Analysis
**Title**: ${analysis.sourceTitle || 'Original Story'}
**Genre**: ${analysis.genre}
**Tone**: ${analysis.tone}
**Setting**: ${JSON.stringify(analysis.setting, null, 2)}
**Themes**: ${analysis.themes?.join(', ') || 'Not specified'}

## Episode Breakdown Context
Total Episodes: ${seasonPlan.totalEpisodes}
Key Locations Across Season: ${[...new Set(seasonPlan.episodes.flatMap(ep => ep.locations))].join(', ')}

## World Building Requirements

Create a rich, immersive world foundation that supports ${seasonPlan.totalEpisodes} episodes of interactive storytelling.

Focus on:
1. **Core locations** that will appear in multiple episodes
2. **Atmospheric details** that establish mood and tone
3. **World rules** (social, physical, magical) that create interesting choices
4. **Cultural context** that informs character behavior and conflicts
5. **Sensory environment** that makes the world feel alive

Return JSON with this structure:

{
  "worldName": "<name or identifying title for this world>",
  "coreTheme": "<central thematic focus that drives world design>",
  "locations": [
    {
      "name": "<location name>",
      "description": "<rich atmospheric description>",
      "importance": "<primary/secondary/background>",
      "atmosphere": "<mood, sensory details, emotional resonance>",
      "keyFeatures": ["<notable feature 1>", "<notable feature 2>"],
      "socialContext": "<who gathers here, what happens here>",
      "potentialConflicts": ["<conflict type 1>", "<conflict type 2>"]
    }
  ],
  "worldRules": {
    "physical": ["<rule 1>", "<rule 2>"],
    "social": ["<rule 1>", "<rule 2>"],
    "supernatural": ["<rule 1>", "<rule 2>"],
    "economic": ["<rule 1>", "<rule 2>"]
  },
  "culturalElements": {
    "traditions": ["<tradition 1>", "<tradition 2>"],
    "taboos": ["<taboo 1>", "<taboo 2>"],
    "values": ["<value 1>", "<value 2>"],
    "conflicts": ["<source of tension 1>", "<source of tension 2>"]
  },
  "atmosphere": {
    "visualStyle": "<overall aesthetic and visual mood>",
    "soundscape": "<ambient sounds, music style, acoustic character>",
    "tactileElements": "<textures, temperatures, physical sensations>",
    "olfactoryElements": "<smells that define the world>",
    "emotionalUndercurrent": "<the feelings this world evokes>"
  },
  "storyOpportunities": [
    "<way the world creates interesting choices>",
    "<way the world supports the themes>",
    "<way the world enables meaningful consequences>"
  ]
}

Make every detail serve the story. Create a world that feels lived-in and generates natural conflicts.
Return ONLY valid JSON.
```

## Stage 2: Character Design

### Agent

`CharacterDesigner`

### System prompt addition

```text
## Your Role: Character Designer

You create compelling, multi-dimensional characters that drive interactive storytelling. Every character must feel real, serve the narrative, and create meaningful choice opportunities.

## Character Design Principles

### Relationship Dynamics
All NPCs are defined primarily by their relationship to the protagonist:
- **Trust**: How much they believe the protagonist
- **Affection**: How much they like the protagonist  
- **Respect**: How much they admire the protagonist
- **Fear**: How intimidated they are by the protagonist

Different character types require different relationship depths:
- **Core NPCs**: All 4 dimensions (antagonists, major allies)
- **Supporting NPCs**: 2+ dimensions (quest givers, recurring characters)
- **Background NPCs**: 1+ dimension (shopkeepers, one-scene characters)

### Character Agency
Every character should:
- Want something specific and achievable
- Be actively pursuing that goal
- Have reasons that make sense to them
- Create opportunities for player choice
- React meaningfully to player decisions

### Conflict Generation
Characters drive story through:
- **Opposing goals**: What they want conflicts with what others want
- **Moral contradictions**: Their methods or values clash with others
- **Competing loyalties**: They're torn between different allegiances
- **Hidden information**: They know things that create tension
- **Resource competition**: They need the same things others need

### Voice & Personality
Each character needs:
- Distinct speaking patterns and vocabulary
- Consistent personality traits and quirks
- Clear values and moral boundaries
- Recognizable emotional patterns
- Specific cultural or social background markers
```

### User prompt

```text
Design the complete cast of characters for this interactive story.

## Story Context
**Title**: ${worldBuilding.worldName}
**Theme**: ${worldBuilding.coreTheme}  
**Genre**: ${analysis.genre}
**Tone**: ${analysis.tone}

## Source Material Characters
${analysis.majorCharacters?.map(char => `- **${char.name}** (${char.role}): ${char.description}`).join('\n') || 'None specified'}

## Protagonist Context
**Name**: ${analysis.protagonist.name}
**Description**: ${analysis.protagonist.description}
**Character Arc**: ${analysis.protagonist.arc}

## Episode Requirements
The story spans ${seasonPlan.totalEpisodes} episodes. Characters need to support:
${seasonPlan.episodes.map(ep => `- Episode ${ep.episodeNumber}: ${ep.title} (${ep.characters.join(', ')})`).join('\n')}

## World Context
**Key Locations**: ${worldBuilding.locations.map(loc => loc.name).join(', ')}
**Cultural Values**: ${worldBuilding.culturalElements.values.join(', ')}
**Central Conflicts**: ${worldBuilding.culturalElements.conflicts.join(', ')}

## Character Design Task

Create a full cast that enables rich interactive storytelling across all episodes.

Requirements:
1. **Core NPCs** (2-4 characters): Drive major plot threads, appear in multiple episodes
2. **Supporting NPCs** (4-6 characters): Enable key scenes, provide specialist knowledge/services  
3. **Background NPCs** (3-5 characters): Populate the world, provide color and context

For each character, consider:
- How they create choices for the protagonist
- What information or capabilities they control  
- How their goals intersect with or oppose the protagonist's journey
- What relationship dynamics they enable

Return JSON with this structure:

{
  "cast": [
    {
      "name": "<character name>",
      "importance": "<core/supporting/background>",
      "role": "<antagonist/ally/mentor/love_interest/rival/neutral/specialist>",
      "description": "<physical appearance and general demeanor>",
      "personality": {
        "traits": ["<trait 1>", "<trait 2>", "<trait 3>"],
        "values": ["<core value 1>", "<core value 2>"],
        "quirks": ["<behavioral quirk>", "<speech pattern>"],
        "fears": ["<what they're afraid of>"],
        "desires": ["<what they want most>"]
      },
      "relationships": {
        "trust": <0-100>,
        "affection": <0-100>, 
        "respect": <0-100>,
        "fear": <0-100>
      },
      "background": {
        "occupation": "<what they do>",
        "origin": "<where they're from>",
        "secrets": ["<hidden information they possess>"],
        "connections": ["<other characters they know>"],
        "resources": ["<what they control or can access>"]
      },
      "storyFunction": {
        "primaryGoal": "<what they're trying to achieve>",
        "conflictSources": ["<how they create tension>"],
        "choiceOpportunities": ["<types of choices they enable>"],
        "informationProvided": ["<what they can reveal>"],
        "episodeAppearances": [<episode numbers where they appear>]
      },
      "voice": {
        "speakingStyle": "<how they talk>",
        "vocabulary": "<word choices, formality level>", 
        "emotionalRange": "<how they express feelings>",
        "culturalMarkers": "<background indicators in speech>"
      }
    }
  ],
  "relationshipWeb": {
    "alliances": ["<character A + character B>"],
    "rivalries": ["<character C vs character D>"],
    "secrets": ["<who knows what about whom>"],
    "dependencies": ["<who needs whom for what>"]
  },
  "characterArcs": [
    {
      "character": "<character name>",
      "startingState": "<how they begin>",
      "potentialEndings": ["<possible conclusion 1>", "<possible conclusion 2>"],
      "keyTransformationMoments": ["<episode X decision point>"]
    }
  ]
}

Focus on creating characters that generate meaningful choices and enable rich relationship dynamics.
Return ONLY valid JSON.
```

## Stage 3: Story Architecture

### Agent

`StoryArchitect`

### System prompt addition

```text
## Your Role: Story Architect

You design the complete narrative structure for a single episode, creating the backbone that all other agents will build upon. You are the MASTER PLANNER who determines scene flow, choice points, encounter placement, and story beats.

## Episode Architecture Principles

### Scene Flow Design
Each episode follows the branch-and-bottleneck pattern:
- **Bottleneck scenes**: Key story moments all players experience
- **Branch zones**: Areas where player choices create divergent paths  
- **Convergence points**: Where different paths come back together
- **Encounter anchors**: Major interactive sequences that define the episode

### Your Core Responsibilities

1. **Scene Blueprint**: Design 5-8 scenes with clear purposes and connections
2. **Choice Architecture**: Plan meaningful decisions with appropriate consequences  
3. **Encounter Integration**: Position encounters as dramatic anchors
4. **Pacing Control**: Balance narrative exposition with interactive moments
5. **State Management**: Track flags, scores, and tags that matter
6. **Consequence Design**: Plan how choices ripple through the episode and beyond

### Encounter Focus
Every episode MUST have 1-2 encounters that serve as dramatic anchors:
- **Encounter scenes** are the ACTION sequences - combat, chases, social confrontations, stealth, puzzles
- They represent the episode's highest tension and most meaningful choices
- Everything else builds toward or flows from these encounters
- Encounter outcomes should create meaningful branches

### Choice Quality Standards
Every choice must pass the Stakes Triangle test:
- **WANT**: Clear goal or desire driving the choice
- **COST**: Meaningful sacrifice, risk, or tradeoff  
- **IDENTITY**: Reveals or shapes who the protagonist is

Apply Choice Geometry framework:
- **Flavor choices**: Personalization, no major consequences
- **Branching choices**: Lead to different experiences, moderate cost
- **Blind choices**: Hidden consequences, use sparingly
- **Moral dilemmas**: No clearly right answer, high impact

### State Architecture
Design episode-level state changes:
- **Flags**: Boolean states for important conditions
- **Scores**: Numerical tracking for relationships, resources, reputation
- **Tags**: Collections for skills, knowledge, affiliations
```

### User prompt

```text
Architect the complete narrative structure for Episode ${episodeNumber}.

## Episode Context
**Title**: ${episode.title}
**Synopsis**: ${episode.synopsis}
**Story Arc**: ${episode.storyArc}
**Previous Episode State**: ${previousEpisodeState || 'None (first episode)'}

## Season Context
**Total Episodes**: ${seasonPlan.totalEpisodes}
**Season Arc**: ${seasonPlan.storyArcs.find(arc => arc.episodes.includes(episodeNumber))?.name || 'Standalone'}
**Cross-Episode Branches**: ${seasonPlan.crossEpisodeBranches.filter(branch => branch.impactsEpisodes.includes(episodeNumber)).map(branch => branch.description).join('; ') || 'None'}

## Available Resources
**World**: ${worldBuilding.worldName} - ${worldBuilding.coreTheme}
**Primary Locations**: ${worldBuilding.locations.filter(loc => loc.importance === 'primary').map(loc => loc.name).join(', ')}
**Available Characters**: ${characterDesigns.cast.map(char => `${char.name} (${char.role})`).join(', ')}

## Season Plan Requirements
${seasonPlan.episodes.find(ep => ep.episodeNumber === episodeNumber) ? `
**Required Encounters**: ${seasonPlan.episodeEncounters.find(enc => enc.episodeNumber === episodeNumber)?.encounters.map(e => `${e.type} (${e.description})`).join(', ') || 'None specified'}
**Expected Characters**: ${seasonPlan.episodes.find(ep => ep.episodeNumber === episodeNumber)?.characters?.join(', ') || 'None specified'}
**Key Plot Points**: ${seasonPlan.episodes.find(ep => ep.episodeNumber === episodeNumber)?.plotPoints?.join('; ') || 'None specified'}
` : 'No specific requirements from season plan'}

## Architecture Task

Design the complete scene-by-scene structure for this episode.

**Critical Requirements**:
1. Include 1-2 encounter scenes as dramatic anchors
2. Create 3-5 meaningful choice points across the episode
3. Ensure first choice appears within 90 seconds of reading
4. Average gap between choices should not exceed 120 seconds
5. Each choice must pass the Stakes Triangle test (Want + Cost + Identity)
6. Design consequence flows that matter within and beyond this episode

Return JSON with this structure:

{
  "episodeNumber": ${episodeNumber},
  "title": "${episode.title}",
  "overallStructure": {
    "totalScenes": <number>,
    "encounterScenes": [<scene numbers>],
    "majorChoicePoints": [<scene numbers>],
    "bottleneckScenes": [<scene numbers>],
    "branchingZones": [
      {
        "startScene": <number>,
        "endScene": <number>,
        "description": "<what varies in this zone>"
      }
    ]
  },
  "scenes": [
    {
      "sceneNumber": <number>,
      "title": "<scene title>",
      "type": "<narrative/encounter/choice_point/resolution>",
      "purpose": "<what this scene accomplishes>",
      "location": "<where this takes place>",
      "characters": ["<character names present>"],
      "estimatedDuration": "<reading time in seconds>",
      "keyBeats": [
        "<story beat 1>",
        "<story beat 2>",
        "<story beat 3>"
      ],
      "choicePoint": {
        "present": <true/false>,
        "choiceType": "<flavor/branching/blind/moral_dilemma>",
        "stakesTri