# Scene Content Rules Adaptation Plan

## Goal

Adapt the supplied scene-content rules into StoryRPG's current pipeline without adding schema or runtime layers.

This layer strengthens how scenes are written, not how they are structurally represented.

The pipeline remains:

```text
Season
  Acts
    Seven-point anchors + buffers
      Episodes
        Episode turns
          Scenes
            Beats
```

Use existing fields:

- `sceneTakeaways`
- `keyMoments`
- `moodProgression`
- `keyBeats`
- `sequenceIntent`
- `dramaticIntent`
- `coveragePlan`
- `visualMoment`
- `primaryAction`
- `emotionalRead`
- `relationshipDynamic`
- `mustShowDetail`
- `intensityTier`

Do not create `chapterBeat`, `episodeTurn`, `sceneBeat`, or any new runtime schema.

## Rule Decisions

| Source rule | Decision | StoryRPG adaptation |
|---|---|---|
| Every scene must have emotional, action, or character purpose that advances the story. | Add / tighten | Every scene should have a felt purpose, and descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce `sceneTakeaways` and `keyMoments`. |
| Scene beats should increase in intensity, tension, or gravitas until resolution. | Modify | The scene should build toward its `keyMoment`, but not mechanically escalate every beat. Rest, contrast, aftermath, reversal, and dread can all serve the build. |
| Final scene beat should have pointed resolution and cliffhanger into the next scene. | Modify | Every final beat should land resolution/consequence plus forward pressure. Use true cliffhangers when appropriate. |
| Final scene of every chapter should cliffhanger into next chapter. | Modify | Chapter maps to episode. Non-finale episodes should end with authored next-episode pressure. Finale/resolution episodes should resolve the central conflict and show aftermath. |
| Jeopardy dialogue should grow urgent and pointed. | Add | As danger, fear, exposure, or time pressure increases, dialogue should become shorter, sharper, interrupted, selective, or stripped down. |
| Characters should never hold static meetings. | Tighten | Dialogue scenes need fitting physical business, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, searching, fighting, medical care, ritual, escape, or another action that makes the power shift visible. |
| Never describe thoughts/feelings; use short dialogue or muttered lines. | Add strongly | Direct thought/feeling exposition should be avoided. Externalize inner life through action, silence, bodily reaction, object handling, short speech, muttered one-liners, facial expression, choice behavior, or what the character does next. |
| Deep emotional moments should use action or brief understated dialogue. | Add | Emotional weight should land through behavior, callbacks, objects, silence, movement, restraint, and short speech rather than explanation. |
| Keep all dialogue spare, quick, and to the point. | Add / adapt | Dialogue should be concise, pressure-aware, and character-specific. Longer speech is reserved for source style, ritual, confession, comedy, or true climax. |
| Physical action should include specific bodily movement. | Add | Important action should include concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction. |
| Fighting/weapons should produce destructive effects, wounds, loud noises, explosions; wounds need detailed descriptions and facial expressions. | Add for fight/action scenes | Fight and weapon scenes should show destructive impact, wounds or visible damage, forceful sound/effects where appropriate, and bodily/facial reactions. |
| Physical action/fighting scenes require serious jeopardy and detailed danger, strikes, wounds, impacts. | Add for fight/action scenes | Combat and physical danger should not be abstract. Show serious jeopardy, specific maneuvers, impacts, wounds, and shifting tactical position. |
| Fight scenes need surprising maneuvers and graphic detail about winning/losing damage. | Add for fight scenes | Fight beats should include tactical reversals, environmental use, specific attacks, and clear physical consequences for winners and losers. |
| Every conflict/fight chapter beat should wound/damage someone; heroes/friends should be wounded or narrowly escape harm. | Modify | Damage can be physical, emotional, social, relational, resource, reputation, information, or identity damage. In action scenes, heroes/allies should be wounded, harmed, depleted, exposed, or narrowly escape a specific harm. |

## StoryArchitect Prompt Changes

Add planning guidance so scene blueprints carry the right pressure before SceneWriter expands them.

### Scene Content Purpose

```markdown
Every scene must have a purpose the player can feel: emotional pressure, action pressure, character development, relationship movement, information gain, consequence, or meaningful aftermath.

Scene descriptions, keyBeats, choice stakes, encounter buildup, and handoffs should all reinforce that purpose.

Do not plan scenes as topic containers. Plan scenes as situations where something changes.
```

### Scene Arc

```markdown
Each scene should build toward its keyMoment.

The beat sequence may include rest, contrast, reversal, dread, or aftermath, but the scene should not feel flat. The final beat should land a pointed resolution, consequence, reveal, emotional shift, choice, or handoff.

Non-finale episode endings should open authored forward pressure into the next episode. Finale/resolution endings should resolve the main conflict and show aftermath rather than forcing a fake cliffhanger.
```

### Conflict And Action Planning

```markdown
If a scene includes conflict, fighting, weapons, pursuit, survival, or physical action, plan concrete jeopardy and consequence.

For fights or weapon use, keyBeats should include:
- specific maneuvers
- destructive impact
- wounds or visible damage
- tactical reversals
- environmental use
- what winning or losing costs

For non-physical conflict, damage may be emotional, social, relational, resource, reputation, information, or identity damage.
```

## SceneWriter Prompt Changes

SceneWriter is the primary implementation surface.

### Purpose Discipline

```markdown
Every scene must have a purpose in emotional, action, or character-related content that advances the story.

Descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce that purpose and help deliver the sceneTakeaways and keyMoment.
```

### Beat Arc

```markdown
Scene beats should build toward the scene keyMoment.

Intensity does not need to rise mechanically every beat, but tension, gravitas, danger, intimacy, consequence, or dramatic clarity should accumulate across the scene.

Use rest beats only when they create contrast, aftermath, dread, tenderness, or sharper payoff.
```

### Scene Ending

```markdown
The final beat of each scene should land a pointed resolution or consequence, then create forward pressure into the next beat, choice, scene, encounter, or episode.

Forward pressure may be a cliffhanger, reveal, unresolved cost, emotional rupture, new danger, changed relationship, choice consequence, or handoff.

For non-finale episode endings, heighten next-episode pressure. For finale/resolution endings, resolve the central conflict and show aftermath.
```

### Jeopardy Dialogue

```markdown
When characters are in jeopardy or believe they are in jeopardy, dialogue should become more pointed, urgent, interrupted, selective, or stripped down.

As fear, danger, exposure, or time pressure increases, reduce explanation and sharpen what characters say.
```

### No Static Meetings

```markdown
Never write a static meeting where characters only discuss information.

If characters talk, ground the conversation in fitting physical activity, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, cleaning, fighting, searching, ritual, medical care, escape, or another action appropriate to the circumstances.

The physical activity should make the power shift or emotional pressure visible.
```

### No Direct Thought/Feeling Description

```markdown
Do not directly describe characters' thoughts and feelings.

Do not write:
- "She felt afraid."
- "He wondered if he had failed."
- "You feel guilty."
- "Mara is angry because..."

Instead, externalize inner life through brief dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling, hesitation, distance or closeness, facial expression, choice behavior, callback objects, or what the character does next.

If a character is alone, use a brief one-line spoken or muttered line when needed.
```

### Emotional Weight

```markdown
If a moment carries deep emotional weight, memory, regret, longing, fear, or reminiscence, express it through action or brief understated dialogue.

Use less explanation, not more.

Let objects, callbacks, silence, movement, and short speech carry the weight.
```

### Dialogue Compression

```markdown
Keep dialogue spare, quick, and to the point.

Dialogue should advance story, reveal character, sharpen pressure, or change the relationship dynamic.

Avoid speeches unless the source style, genre, ritual, confession, comedy, or climax truly calls for one.
```

### Physical Specificity

```markdown
When physical action matters, include specific bodily movement.

Use concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction.

Do not over-choreograph quiet beats, but never make important action vague.
```

### Fight, Weapon, And Physical Action Scenes

```markdown
If a scene includes fighting, weapons, pursuit, survival danger, or major physical action, make the danger concrete and serious.

Fight/action beats should include:
- specific strikes, maneuvers, evasions, blocks, grapples, throws, falls, impacts, wounds, or damage
- destructive effects from weapons or powers
- loud or forceful consequences when appropriate: clashes, cracks, explosions, splintering, shattering, tearing, ringing impact
- surprising tactical choices or environmental use
- visible harm, depletion, fear, pain, exhaustion, or loss of advantage
- facial expressions and bodily reactions when characters are wounded or damaged
- a clear explanation through action of how the winning side succeeds
- a clear cost for the losing side

Do not let fights become abstract summaries.

In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm.
```

### Conflict Damage

```markdown
Every meaningful conflict should damage someone or something.

Damage may be physical injury, emotional hurt, social humiliation, relational rupture, resource loss, reputation damage, information exposure, identity pressure, moral compromise, lost leverage, increased danger, or narrowing options.

In fight/action scenes, damage should usually be physical, tactical, environmental, or resource-based, with emotional fallout where appropriate.

In non-action scenes, damage can be social, relational, emotional, informational, reputational, or identity-based.
```

## Advisory Validation

Extend `SceneCraftValidator` with warnings only.

Add warnings for:

- scene content does not clearly reinforce purpose, takeaways, or keyMoment
- scene arc feels flat
- final beat lacks pointed resolution, consequence, or forward pressure
- jeopardy dialogue reads too casual or explanatory
- dialogue scene lacks physical business or situational pressure
- beat directly explains thought or feeling
- dialogue is too long for spare, pressure-aware scene prose
- physical action lacks specific bodily movement or visible impact
- fight/weapon scene lacks visible damage, destructive impact, or serious jeopardy
- conflict lacks visible cost or damage state

Keep these advisory. They should guide retries and QA without blocking quiet, sparse, or source-faithful scenes.

## Tests

Add focused tests for:

- StoryArchitect prompt includes scene content purpose, scene arc, and conflict/action planning.
- SceneWriter prompt includes no direct thought/feeling description, fight/action rules, and conflict damage.
- SceneCraftValidator warns but does not fail on:
  - direct thought/feeling exposition
  - static meetings
  - jeopardy dialogue that is too casual
  - vague physical action
  - fight scene with no damage
  - conflict with no cost
  - weak final beat
- SceneCraftValidator does not warn for:
  - fight/action with concrete strikes, wounds, impacts, and cost
  - conflict with emotional/social/reputational damage
  - finale resolution with aftermath/legacy instead of a cliffhanger

Run:

```bash
npm test -- SceneCraftValidator SceneWriter StoryArchitect
npm run typecheck
```

## Canonical Adapted Rule

Every scene has a felt purpose; every beat externalizes story movement through action, dialogue, pressure, or consequence; every scene builds toward a keyMoment and ends with resolution plus forward pressure; emotional content is shown through behavior and spare speech; conflict always costs something; fight and weapon scenes must show serious jeopardy, specific maneuvers, destructive impact, wounds or damage, and visible consequences.
