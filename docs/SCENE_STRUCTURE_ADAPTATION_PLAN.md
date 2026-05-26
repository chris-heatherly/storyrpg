# Scene Structure Adaptation Plan

## Goal

Adapt the external Scene Structure rules into StoryRPG's existing generation pipeline while preserving:

- fiction-first prose
- genre flexibility
- source/style fidelity
- current schema compatibility
- visual/image pipeline style controls
- LLM creativity

Do not create a new scene schema or "chapter beat" data model.

## Vocabulary Mapping

| External term | StoryRPG term |
|---|---|
| Chapter | Episode |
| Chapter beat | Episode turn |
| Scene | Scene |
| Scene beat | Beat |

## Rule Decisions

| Source rule | Decision | Implementation |
|---|---|---|
| Analyze chapter beats and determine separate scenes | Adapt | StoryArchitect should split episode turns into scenes only when there is a meaningful boundary. |
| Change of location | Add | Add explicit scene-splitting guidance to StoryArchitect. |
| Significant time passage | Add | Add explicit scene-splitting guidance to StoryArchitect and preserve SceneWriter `transitionIn`. |
| Shift in character dynamics | Add | Add as scene-splitting guidance when trust, power, intimacy, suspicion, or alliance changes enough. |
| New dramatic tension | Adapt | Add guidance: large new tension may require a new scene; small tension shifts can stay as a dominant beat. |
| Determine scene mood/vibe | Tighten | Keep existing `mood` and `moodProgression`; ask for concise mood labels and concrete emotional movement. |
| Identify scene takeaways | Already present / keep | No code change. Existing `sceneTakeaways` and validator coverage stay. |
| Break each scene into 3-8 granular scene beats | Adapt | Make 3-8 the default generated range; expose controls so users can increase/decrease in the Generator tool. |
| Scene beat shows action/dialogue/emotion development | Tighten | SceneWriter should say each non-rest beat changes action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence. |
| Specific detailed action/dialogue | Already present / keep | No change. Existing visual contract and dramatic intent rules cover this. |
| Change in character intent, mood, or dynamics | Add | Add explicitly to SceneWriter Scene Craft Targets. |
| Vividly described | Adapt | Replace "vivid prose" framing with "vivid story intent": concrete story turn, clear dialogue/subtext, and image-safe visual direction that respects style and negative prompts. |
| Dialogue clear, concise, natural | Already present / keep | No change. |
| Dialogue advances story | Already present / keep | No change. |
| Dialogue supports emotion/intention/tone | Already present / keep | No change. |
| Identify key moment | Already present / keep | No change to field existence. |
| Key moment culminates takeaways | Add | SceneWriter should state the `keyMoment` is where scene takeaways become felt, proven, revealed, or changed. |
| Maintain clarity and flow | Tighten | SceneWriter can bridge gaps naturally but must not contradict anchors, source fidelity, player state, or prior choices. |
| Fill missing info / expand vague elements | Adapt | Allow local connective invention for coherence, tension, or character development; forbid major canon-breaking plot invention. |
| Enhance story naturally | Adapt | Define acceptable enhancements: concrete action, transition, emotional pressure, physical business, clue, consequence, or relationship texture. |

## Generator UX Beat Range

Default scene beat range should become **3-8 beats per scene**.

Update defaults:

- `minBeatsPerScene`: keep default `3`.
- `maxBeatsPerScene`: change default from `12` to `8`.
- `standardBeatCount`: keep default `8` unless tests indicate it is duplicative with `maxBeatsPerScene`.
- `bottleneckBeatCount`: reduce default from `10` to `8` so normal bottlenecks obey the default 3-8 scene-beat target.
- `encounterBeatCount`: leave unchanged unless encounter tests show it is too low.

Update Generator settings UX:

- `Min Beats per Scene`
  - default: `3`
  - allow user decrease/increase
  - recommended UI range: `1-6`
  - description: "Default lower bound for generated scene beats. 3 is recommended."

- `Max Beats per Scene`
  - default: `8`
  - allow user decrease/increase
  - recommended UI range: `4-12`
  - description: "Default upper bound for generated scene beats. 8 is recommended; increase only for unusually dense scenes."

- `Standard Scene Beats`
  - default: `8`
  - recommended UI range: `3-10`
  - description: "Target cap for standard prose scenes."

- `Bottleneck Scene Beats`
  - default: `8`
  - recommended UI range: `4-12`
  - description: "Target cap for key bottleneck scenes; use higher values sparingly."

Do not hard-lock every scene to exactly 3-8 beats. The default should steer normal prose scenes toward 3-8, while the tool still allows controlled adjustment.

## Prompt Changes

### StoryArchitect

Add a Scene Splitting section:

```markdown
## Scene Splitting

Split episode turns into separate scenes when there is a meaningful change in location, time, character dynamics, objective, obstacle, or dramatic tension.

Do not create a new scene for tiny tonal shifts. Fold small shifts into beats. A new scene should represent a real change in situation, not just a new topic.
```

Tighten scene planning language:

```markdown
Each scene should have a concise mood label and keyBeats that describe major turns, not topics.
Use keyBeats to show the scene's purpose, pressure, visible action, and handoff into the next scene or encounter.
```

### SceneWriter

Tighten Scene Craft Targets:

```markdown
Scene takeaways are load-bearing: they name what the player learns, feels, or understands about story, character, relationship, theme, information, or player-state pressure.

The scene keyMoment should be the beat where those takeaways become felt, proven, revealed, or changed.

Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
```

Add clarity/flow guidance:

```markdown
If the blueprint leaves small connective gaps, fill them naturally with local detail: transition, concrete action, emotional pressure, physical business, clue, consequence, or relationship texture.

Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context.
```

Replace "vivid" wording with style-safe intent:

```markdown
Vivid means vivid story intent, not ornate prose or generic cinematic styling.

For player-facing prose: use concrete, concise action and dialogue that makes the story turn legible.

For visual metadata and image-facing fields: provide specific story intent, visible action, relationship dynamics, required details, and subtext cues. Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors.
```

Add image-prompt safety guidance:

```markdown
Visual metadata should describe what must be understood, not impose a conflicting style. Avoid generic style words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, flat, gritty, glossy, symmetrical, or high contrast unless they come from the active style contract.
```

## Advisory Validation

Extend `SceneCraftValidator` without making it punitive.

Add warnings only:

- Scene has fewer than configured `minBeatsPerScene`.
- Scene has more than configured `maxBeatsPerScene`.
- `keyMoments` exist but do not appear related to `sceneTakeaways` by simple token overlap or shared terms.
- Non-rest beats lack evidence of a concrete turn in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
- Visual metadata contains style-fighting language that belongs to art direction rather than story intent.

Keep warnings advisory. Do not hard-fail quiet scenes, rest scenes, stylistically minimal scenes, or source-faithful sparse prose.

## Image-Pipeline Guardrail

Add a lightweight helper or validator check for image-facing scene/beat fields:

Fields to scan:

- `visualMoment`
- `primaryAction`
- `emotionalRead`
- `relationshipDynamic`
- `mustShowDetail`
- `dramaticIntent.visibleTurn`
- `dramaticIntent.visualSubtextCue`
- `sequenceIntent.visualThread`

Warn on generic style-direction terms that can fight active style:

- cinematic
- hyperreal
- photoreal
- painterly
- anime
- dramatic lighting
- high contrast
- vivid colors
- gritty
- glossy
- flat lighting
- symmetrical composition
- bokeh
- ultra detailed
- realistic

Allowed exception:

- If the term appears in the active `ArtStyleProfile`, source style contract, style-bible anchor, or provider-specific prompt layer, do not warn.

The goal is not to remove visual specificity. The goal is to keep visual specificity about story intent rather than accidental style override.

## Files Likely To Change

- `docs/SCENE_STRUCTURE_ADAPTATION_PLAN.md`
- `storyrpg-prototype/src/constants/pipeline.ts`
- `storyrpg-prototype/src/components/GenerationSettingsPanel.tsx`
- `storyrpg-prototype/src/ai-agents/agents/StoryArchitect.ts`
- `storyrpg-prototype/src/ai-agents/agents/SceneWriter.ts`
- `storyrpg-prototype/src/ai-agents/validators/SceneCraftValidator.ts`
- focused tests for the changed defaults/prompts/validator warnings

Do not change fields or schema types unless implementation discovers an existing config type needs the new advisory options.

## Tests

Run focused tests:

```bash
npm test -- SceneCraftValidator SceneWriter StoryArchitect buildPipelineConfig
npm run typecheck
```

Add or update tests for:

- Generator defaults expose 3-8 beats per scene.
- UX still allows increasing/decreasing beat controls.
- StoryArchitect prompt includes scene-splitting guidance.
- SceneWriter prompt includes:
  - keyMoment culminates sceneTakeaways
  - vivid story intent wording
  - style-safe visual metadata guidance
  - clarity/fill-gap constraints
- SceneCraftValidator warns, but does not fail, on beat-count drift.
- Style-fighting image-facing language produces warnings only.

## Non-Goals

- Do not create `episodeTurns` or `sceneBeats` as new schema fields.
- Do not rewrite existing rules marked "already present / keep."
- Do not hard-fail creative scenes for being quiet, sparse, non-combat, or source-faithful.
- Do not add prose rules that create purple prose.
- Do not add image metadata wording that overrides ArtStyleProfile, negative prompts, style-bible anchors, provider settings, or visual pipeline constraints.
