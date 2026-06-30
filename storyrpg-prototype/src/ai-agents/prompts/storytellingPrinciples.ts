/**
 * Core Storytelling Principles
 * Derived from the Interactive Storytelling Complete Expert Guide.
 * These principles are embedded into every agent's system prompt.
 */

import type {
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import {
  STORY_CIRCLE_BEAT_DEFINITION_LINES,
  STORY_CIRCLE_GEOMETRY_PRINCIPLES,
} from '../utils/storyCircleDistribution';
import { STORY_QUALITY_PIXAR_CRAFT } from './storyQualityContract';

/**
 * Build a reusable prompt section that gives a narrative agent the
 * season-level anchors, the Story Circle beat map, and which beat(s) the
 * current episode carries. Call from any agent's prompt builder; returns an
 * empty string when no structural context is supplied so the agent's existing
 * behavior is preserved for callers that predate Path A.
 *
 * Every downstream narrative writer (SceneWriter, ChoiceAuthor,
 * EncounterArchitect, ThreadPlanner, TwistArchitect, CharacterArcTracker,
 * BranchManager, CharacterDesigner) should include this section so the
 * episode reads as a single story at the season level.
 */
export function buildStructuralContextSection(params: {
  anchors?: StoryAnchors;
  storyCircle?: StoryCircleStructure;
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  episodeCircle?: StoryCircleStructure;
}): string {
  const {
    anchors,
    storyCircle,
    episodeStoryCircleRole,
    episodeCircle,
  } = params;
  const storyCircleRole = episodeStoryCircleRole ?? [];

  if (
    !anchors
    && !storyCircle
    && storyCircleRole.length === 0
    && !episodeCircle
  ) {
    return '';
  }

  const anchorLines = anchors
    ? [
        `- Stakes: ${anchors.stakes}`,
        `- Goal: ${anchors.goal}`,
        `- Inciting Incident: ${anchors.incitingIncident}`,
        `- Climax: ${anchors.climax}`,
      ].join('\n')
    : '';

  const storyCircleLines = storyCircle
    ? STORY_CIRCLE_BEATS.map((beat) => `- ${beat}: ${storyCircle[beat]}`).join('\n')
    : '';

  const episodeCircleLines = episodeCircle
    ? STORY_CIRCLE_BEATS.map((beat) => `- ${beat}: ${episodeCircle[beat]}`).join('\n')
    : '';

  const roleLine = storyCircleRole.length > 0
    ? storyCircleRole.map((role) =>
        role.roleKind === 'expansion'
          ? `${role.beat} (expansion of primary ${role.beat})`
          : role.beat
      ).join(', ')
    : '(none supplied)';

  const roleDefinitionLines = storyCircleRole.length > 0
    ? storyCircleRole.map((role) => {
        const definition = STORY_CIRCLE_BEAT_DEFINITION_LINES.find((line) => line.startsWith(`\`${role.beat}\``));
        return definition ? `- ${definition}` : `- \`${role.beat}\``;
      }).join('\n')
    : '(none supplied)';

  return `
## Season Anchors (shared reference — every beat, scene, and choice must serve these)
${anchorLines || '(none supplied)'}

## Canonical Story Circle Beat Definitions (authoritative — do not summarize or replace)
${STORY_CIRCLE_BEAT_DEFINITION_LINES.join('\n')}

## Story Circle Shape Principles (authoritative — enforce the concepts, not just the labels)
${STORY_CIRCLE_GEOMETRY_PRINCIPLES.join('\n')}

## Season Story Circle Beat Map
${storyCircleLines || '(none supplied)'}

${episodeCircleLines ? `## Episode Story Circle Beat Map (fractal loop — fill all eight beats inside this episode)
${episodeCircleLines}
` : ''}

## This Episode's Story Circle Role
${roleLine}

## Full Definition(s) For This Episode's Assigned Story Circle Beat(s)
${roleDefinitionLines}

Keep every line of prose, every choice, and every consequence grounded in
these anchors, the Story Circle roles, and the Story Circle shape principles.
Cold opens are the first visible
realization of \`you + need\`. Non-finale cliffhangers must resolve or alter
the immediate episode pressure, then launch the next \`need\` or force the
next \`go\`. \`find\` endings expose the problem created by the prize.
\`take\` endings carry the strongest hooks: cost, rupture, loss, apparent
failure, or identity wound. \`change\` endings close the main circle and may
seed only earned legacy/future pressure.
`;
}

export const FICTION_FIRST_PHILOSOPHY = `
## Fiction-First Philosophy

You create interactive narratives where FICTION ALWAYS COMES FIRST:
- Rules follow fiction, never the reverse
- Game mechanics should be invisible in the prose
- Player agency is paramount - their choices must matter
- Every moment should feel like a story, not a game system
- Statistics and numbers stay behind the curtain
`;

export const STAKES_TRIANGLE = `
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
`;

export const CHOICE_GEOMETRY = `
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
`;

export const CONSEQUENCE_BUDGETING = `
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
`;

export const THREE_LAYER_MEMORY = `
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
`;

export const BRANCH_AND_BOTTLENECK = `
## Branch-and-Bottleneck Structure

Structure episodes using the "string of pearls" pattern:

1. **Bottleneck (Pearl)**: A key story moment all players experience
2. **Branch Zone**: Player choices create divergent paths
3. **Bottleneck (Pearl)**: Paths converge for another key moment
4. **Branch Zone**: New choices open up
5. Repeat...

Benefits:
- Ensures all players hit crucial story beats
- Allows meaningful divergence between bottlenecks
- Makes production manageable
- Creates natural episode/chapter breaks
`;

export const QUALITY_MANTRAS = `
## Quality Mantras

Before finalizing any content, ask:
- "Would I want to read this?"
- "Does this choice feel real and meaningful?"
- "Is the world internally consistent?"
- "Does each character sound distinct?"
- "Am I showing, not telling?"
- "Does this moment have stakes?"
`;

export const FIVE_FACTOR_TEST = `
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
`;

export const NPC_DEPTH_TIERING = `
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
`;

export const CHOICE_DENSITY_REQUIREMENTS = `
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
`;

export const CHOICE_PAYOFF_AND_RECONVERGENCE = `
## Choice Payoff And Reconvergence

Meaningful choices are remembered on the page, not only in hidden state.

### Reminder Requirement
- Every meaningful choice should have an immediate echo, a short-horizon acknowledgment, or a later callback
- Ask: who noticed, what changed, and how will the player feel that change?

### Reconvergence Rule
- Reconvergence is allowed; emotional reset is not
- When branches rejoin, preserve residue through dialogue, information, tone, leverage, or identity pressure
- If a branch only changes routing and leaves no visible residue, it should probably be a tint/callback instead

### Distinct Experience Rule
- Judge branching by distinct player experience, not raw scene-count divergence
- A branch is strong when two players could compare notes and describe meaningfully different versions of the same story moment
`;

export const FICTION_FIRST_STATS_AND_SKILLS = `
## Fiction-First Stats And Skills

Hide numbers, not meaning.

### Competence Clarity
- Players should understand what their character is good at in story terms
- Use stable fictional meanings for attributes and skills
- Let locked reasons, NPC reactions, and environment clues teach the system

### Three Uses Of Stats
- **Passive expression**: what the protagonist notices, senses, or misreads
- **Active attempts**: what they can try under pressure
- **Gates**: what they are not ready to do yet

### Growth Rule
- Growth should be narratively legible
- Improvement comes from use, consequence, mentorship, preparation, and hard-earned lessons
- Failures should often open recovery, training, prep, or alternate-leverage paths
`;

export const FICTION_FIRST_GAME_FEEL = `
## Fiction-First Game Feel

Meaningful choices should feel committed in the interface as well as in the prose.

### Commit Ceremony
- Important choices should have a clear rhythm: commit, tension, reveal, aftermath
- Use feedback to make the moment feel weighty without exposing math

### Diegetic Legibility
- Prefer risk and leverage framing such as "steady", "desperate", "they trust you", or "you're out of your depth"
- Reinforce major outcomes with immediate sensory response and later reminders

### Lasting Residue
- Give major outcomes both an instant emotional hit and a lingering summary
- Reuse recognizable motifs for relationship shifts, identity echoes, butterfly callbacks, and training gains
`;

// Combined prompt for embedding in all agents
export const NARRATIVE_INTENSITY_RULES = `
## Narrative Intensity Tiering

A scene is a musical phrase. It needs dominant notes, supporting notes, and rests.
Every scene must vary its beat intensity — a scene where every beat hits at the same level is a failure.

**DOMINANT beats** (1-2 per scene): Peak drama. Strong selective sensory detail, highest emotional pressure, most vivid physical action.
Write for the reader to feel the impact in their body. These are climax moments, key story beats, confrontations, betrayals, triumphs.

**SUPPORTING beats** (majority): Advance the plot. Active prose, forward momentum, clear actions and reactions.
Standard beat length. Characters doing, deciding, responding. The engine of the story.

**REST beats** (1-2 per scene): Breathing room. Shorter prose, more environmental/atmospheric, quieter tone.
A character processing what just happened, an environmental detail that sets mood, a moment of stillness before the next escalation.
These pauses make the dominant beats land harder.

**Pacing arc**: Open with a supporting or rest beat to orient the reader. Build through supporting beats.
Hit one dominant peak. Follow with a rest beat to let it land. Build again if the scene has a second peak.
End on a supporting or dominant beat leading into the choice/transition.

For each beat you generate, assign an \`intensityTier\` field: "dominant", "supporting", or "rest".
`;

export const CRAFT_PRESSURE_GUIDANCE = `
## Genre-Aware Craft Pressure (StoryRPG Guardrailed)

Use these rules to make scenes sharper, not narrower. If any craft rule conflicts
with fiction-first interactivity, genre flexibility, rest beats, externalized
emotion, or serialized cliffhanger planning, StoryRPG's
existing principles win.

- Treat scene takeaways as load-bearing: every scene should make the player
  learn, feel, or understand something specific about plot, character, theme,
  information, or relationship pressure.
- Keep scenes active. When characters discuss plans, feelings, secrets, or
  accusations, give them fitting physical business or situational pressure
  instead of a static meeting.
- Make key beats decisive: characters take specific actions, encounter a
  surprising complication, and leave visible consequences or changed leverage.
- Escalate across the episode and season while preserving rests. Do not force
  every beat to be more intense than the previous beat.
- Let protagonist growth become legible through difficulty: pressure exposes a
  shortfall, the player acts anyway, and later scenes show new competence,
  resolve, relationships, or identity.
- Keep dialogue concise, pointed, and subtextual. Conversations need friction,
  pressure, competing agendas, avoidance, teasing, or vulnerability; they do not
  always need overt argument.
- Prefer action, bodily response, silence, object handling, facial expression,
  and brief dialogue to express emotion. Do not directly explain thoughts or
  feelings.
- End scenes with pointed forward pressure: a choice, consequence, reveal,
  cliffhanger, aftermath turn, or newly sharpened question.
- Match jeopardy to genre. Action-heavy genres should include physical danger or
  direct conflict; other genres should use serious social, emotional, moral,
  investigative, environmental, resource, romantic, or identity jeopardy.
- In fight, weapon, pursuit, survival, or major physical-action scenes, make
  danger concrete through serious jeopardy, destructive impact, wounds or
  visible damage, bodily reactions, and consequences.
`;

export const CORE_DRAMATIC_STRUCTURE_RULES = `
## Core Dramatic Structure Rules (Path-Aware Editorial Gates)

Apply these rules to every reachable player path. Player choices may change
the direction of the story, but no reachable direction may become causal
filler, passive spectacle, unearned payoff, information confusion, or emotional
reset. Reconvergence is allowed; causal, emotional, informational, and identity
residue must survive reconvergence.

1. **No "And Then" Scenes**
   Every scene transition must be explainable as "therefore" or "but", not
   merely "and then". The next scene must become necessary through consequence,
   reversal, discovery, cost, escalation, or choice residue, not simple
   chronology.

2. **Protagonist-Driven Plot**
   At least 60% of major plot turns should be caused or meaningfully reshaped
   by protagonist/player action: choice, failed attempt, preparation,
   relationship leverage, information use, refusal, sacrifice, mistake, or
   identity commitment.

3. **Personal Stakes Anchor**
   Every episode and every major scene must name the concrete personal stake
   underneath the plot stake: a person, bond, place, promise, identity,
   reputation, memory, home, future, or irreversible cost.
   Use stakes layers to name what kind of loss is on the table: material,
   relational, identity, and/or existential. Stakes layers define the pressure;
   the Stakes Triangle makes the pressure playable through want, cost, and
   identity.
   Major scenes, encounters, dilemmas, and climaxes should stack
   at least three stakes layers. Do not promote material pressure to
   existential stakes until the player understands what personal, relational,
   or identity loss makes the larger threat matter.
   Within a scene, build a stakes ladder: each beat should raise risk, reveal
   cost, narrow options, shift leverage, or deepen consequence until the
   pressure peak carries the maximum stakes. Rest beats can raise dread,
   clarity, regret, or emotional cost rather than volume.

4. **Dramatic Structure At Every Magnitude**
   Every scene, episode, arc, and season needs its own dramatic
   shape: question/pressure, turn or recontextualization, pressure peak or
   highest cost, and resolution or changed state. Lower levels reinforce higher
   levels.
   Every scene must also satisfy the Scene Turn Contract: entry intent, active
   obstacle, forced decision, and exit shift. The decision may be a visible
   player choice, character commitment, refusal, revelation, sacrifice,
   tradeoff, or irreversible reaction. Rest and aftermath scenes still need
   intent, resistance, and changed footing.
   In multi-character scenes, the power dynamic must shift at least once:
   leverage, trust, vulnerability, intimacy, distance, status, information,
   threat, debt, or public/private advantage changes hands. A scene must also
   pass the removability test: if removing it changes no information,
   relationship, identity, resource/access, danger, promise, payoff, choice
   consequence, theme pressure, stakes, route state, or emotional footing,
   cut or rewrite it. Start scenes as late as possible and leave as soon as
   the turn, decision, consequence, or handoff lands.
   Episode structure uses pressure architecture, not rigid TV act counts:
   one central episode question, an opening promise, meaningful episode turns,
   protagonist-facing pressure lanes, changed episode end state, and forward
   momentum. Use the Story Circle fractally as the required eight-beat episode
   shape while still keeping each scene active, economical, and consequence-led.
   A-plot is the external episode pressure. B-plot is playable
   relationship or identity pressure and may be a scene, an
   underlay inside an A-plot scene, or offscreen pressure surfaced through
   protagonist-visible signals. C-plot is planted future pressure: a future
   seed, callback, world-pressure hint, or tonal counterweight with a visible
   plant and payoff plan. The protagonist remains the viewpoint; do not create
   non-protagonist POV scenes or omniscient cutaways.
   Arc structure is a 3-8 episode pressure movement inside the season, not a
   competing act schema. The season Story Circle spine wins if concepts conflict.
   Each arc needs a distinct arc question related to the season question, an
   identity pressure facet, a midpoint recontextualization that changes the
   question being asked, a late arc crisis/apparent failure or irreversible
   cost, a finale answer, and handoff pressure unless the arc is also the
   season finale. Episodes inside the arc function as Story Circle-aligned
   arc turn-outs: each ending must escalate, reverse, reveal, cost, force a
   choice, recontextualize, hit crisis, answer, or hand off pressure.
   Character architecture makes this personal: the protagonist has an
   agent-facing Lie/protective belief, origin pressure, Truth, Want, Need, and
   active climax choice. Use these to shape plot pressure and choice design,
   but never expose Lie/Wound/Truth labels to the player. Supporting
   character micro-Lies belong only to core/supporting characters and must
   surface through protagonist-visible behavior, contradiction, secret,
   relationship pressure, or choice residue.
   Season promise architecture defines the season's dramatic question, central
   pressure, premise/player/emotional promises, and completeness target. Use
   it to prevent drift, not to impose TV formulas. Do not force re-pilot
   structure, fixed tent-poles, or penultimate climax when the Story Circle
   spine, source, or player agency calls for another
   shape.
   Information management uses a season ledger: every key secret, threat,
   reveal, plant, or payoff declares who knows it, who does not, whether it is
   suspense/mystery/dramatic irony/surprise/revelation/foreshadowing, and when
   it pays off. Mystery/box questions are capped at 3 per season. Major plants
   should pay off after 3-4 episodes; shorter
   seasons should still give the largest payoffs as much runway as possible.

5. **Theme As Plot Pressure**
   The season's theme must be a working question, not a noun. "Family" is not
   a playable theme; "What do you owe family when loyalty costs your selfhood?"
   is. Each episode should test the question from a distinct angle through
   conflict, choice, cost, relationship pressure, information, or identity
   movement. Major choices should make the theme answerable by protagonist /
   player action, not by coincidence, prophecy, villain action, or external
   rescue. Never state the theme question directly through dialogue. Major
   scenes must press, complicate, set up, or pay off the theme question.

6. **No Unearned Payoffs**
   Every reveal, reversal, escalation, rescue, betrayal, power shift, and
   climactic solution needs setup proportional to its importance.

7. **Information Has Ownership**
   Every major clue, secret, threat, and open question must declare who knows
   it and when it pays off: player/audience, protagonist, ally, antagonist, or
   world. The player must know enough to roleplay intent.

8. **No Reset Units**
   Every scene, episode, arc, and season must leave residue:
   changed information, leverage, relationship, identity, resource, danger,
   promise, wound, reputation, location access, or future option.
`;

const ACTION_HEAVY_GENRES = [
  'action',
  'adventure',
  'superhero',
  'thriller',
  'war',
  'martial',
  'survival',
  'heist',
  'western',
];

export function isActionHeavyGenre(genre?: string): boolean {
  const normalized = (genre || '').toLowerCase();
  return ACTION_HEAVY_GENRES.some((token) => normalized.includes(token));
}

export function buildGenreAwareJeopardyGuidance(genre?: string): string {
  if (isActionHeavyGenre(genre)) {
    return 'For this action-heavy genre, include serious physical danger or direct conflict when the story is between the Inciting Incident and the Climax. Keep violence concrete but not graphic unless the rating allows it.';
  }

  return 'For this genre, do not force combat. Make jeopardy serious through social cost, emotional exposure, moral compromise, investigation risk, environmental pressure, resource loss, romantic vulnerability, or identity pressure.';
}

export const CORE_STORYTELLING_PROMPT = `
${FICTION_FIRST_PHILOSOPHY}
${STAKES_TRIANGLE}
${CHOICE_GEOMETRY}
${CONSEQUENCE_BUDGETING}
${THREE_LAYER_MEMORY}
${BRANCH_AND_BOTTLENECK}
${FIVE_FACTOR_TEST}
${NPC_DEPTH_TIERING}
${CHOICE_DENSITY_REQUIREMENTS}
${CHOICE_PAYOFF_AND_RECONVERGENCE}
${FICTION_FIRST_STATS_AND_SKILLS}
${FICTION_FIRST_GAME_FEEL}
${STORY_QUALITY_PIXAR_CRAFT}
${QUALITY_MANTRAS}
`;
