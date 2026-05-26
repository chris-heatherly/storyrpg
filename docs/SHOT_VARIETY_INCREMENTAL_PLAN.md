# Incremental Shot Variety Plan

This plan captures a staged, low-regression approach to improving shot variety,
storyboard flow, and lightweight cinematographic direction in the StoryRPG image
pipeline.

## Guiding Principle

Keep the current pipeline intact. Add lightweight intent fields and validators
around the existing `VisualStoryboardPacket`, rather than replacing `VisualPlan`,
`StoryboardAgent`, visual-storyboard packets, or storyboard-v2 rendering.

The goal is to improve shot variety by making current metadata a little smarter,
not by rebuilding the planning stack.

## Current State To Preserve

The current image pipeline already has useful shot-planning infrastructure:

- `VisualPlan` carries detailed storyboard output from `StoryboardAgent`,
  including shot size, camera angle, horizontal angle, pose, lighting,
  composition, focal point, depth layers, and visual storytelling specs.
- `VisualStoryboardPacket` already exists as the per-scene/chunk planning
  packet consumed downstream. It includes scene style/location/cast policy,
  continuity bible, sequence grammar, shot rows, camera metadata, third-person
  POV mode, visible/offscreen cast, prompt fields, reference-pack summaries, and
  validation.
- `buildSceneVisualStoryboardPlan()` maps beat/encounter/storylet slots into
  storyboard sheets and panel metadata.
- `applyThirdPersonRenderContract()` already injects packet metadata into final
  beat image prompts.
- Existing third-person POV protections, packet persistence, prompt diagnostics,
  storyboard-v2 rendering, and final prompt contracts should remain intact.

This plan should layer better direction onto those pieces. It should not remove
or replace them in the first pass.

## Lightweight Director-Brief Intent

The intended metadata should feel like direction from a director or storyboard
lead, not a rigid render specification. It should say why the panel exists and
what must remain continuous, while leaving exact pose, expression,
micro-composition, and visual flourish to the renderer.

Useful per-panel concepts:

```ts
shotPurpose?:
  | 'establish geography'
  | 'carry interaction'
  | 'deliver emotional peak'
  | 'punctuate key detail'
  | 'separate characters psychologically'
  | 'unite characters relationally'
  | 'refresh spatial map';

coverage?:
  | 'wide geography'
  | 'medium interaction'
  | 'two-shot'
  | 'speaker medium'
  | 'listener reaction'
  | 'over-the-shoulder'
  | 'detail insert'
  | 'from behind'
  | 'environmental aftermath';

relationshipFrame?:
  | 'confrontation'
  | 'equality'
  | 'power imbalance'
  | 'solidarity'
  | 'separation within same space';
```

Other useful optional fields:

```ts
storyFunction?: string;
shotIntent?: string;
requiredVisible?: string[];
optionalVisible?: string[];
offscreen?: string[];
mustShow?: string;
continuityFromPrevious?: string;
varyFromPrevious?: string;
screenDirection?: string;
avoid?: string[];
continuityBreak?: {
  rule: 'axis' | 'eyeline' | 'screen direction';
  reason: string;
};
```

For the incremental rollout, prefer adding the smallest subset first:
`shotPurpose`, `coverage`, `relationshipFrame`, `varyFromPrevious`,
`screenDirection`, and `avoid`.

## Field-By-Field: What Exists Today, What Changes, Priority

Use this section to decide what to pare back. The highest-priority fields are
the ones that give the LLM more creative direction while preserving consistency
and context.

### Already Strong Today

These should be preserved and reused rather than duplicated:

- `sequenceRole`: already gives broad narrative position (`establishing`,
  `relationship`, `insert`, `reaction`, `confrontation`, `reversal`, `outcome`,
  `aftermath`). This is useful but too coarse to explain why a shot exists.
- `shotSize`, `cameraAngle`, `cameraHeight`, `cameraSide`: already give the
  renderer basic camera grammar. These are useful consistency anchors, but they
  do not by themselves prevent generic protagonist-front framing.
- `thirdPersonPov`: already protects against first-person/player-eye images.
  Keep this as a hard consistency field.
- `requiredVisibleCharacterIds`, `optionalBackgroundCharacterIds`,
  `offscreenCharacterIds`: already protect cast discipline. Keep these as hard
  consistency fields.
- `continuityFrom`: already links a shot to the prior panel/slot. It is useful
  but currently too thin to describe what carries over or what should change.
- `promptFields.action`, `promptFields.emotionalRead`,
  `promptFields.keyDetail`, `promptFields.composition`: already carry the
  story moment and some prompt-ready detail. These should remain the core story
  facts for rendering.
- `continuityBible` and `sequenceGrammar`: already describe scene-wide visual
  context. They are good places to hang higher-level continuity and rhythm, but
  should stay compact.

### Highest Priority Additions

These are the best first additions because they empower the LLM creatively
without reducing consistency:

1. `shotPurpose`
   - Today: implied by `sequenceRole`, `shotSize`, and `dramaticReason`.
   - Add: one compact reason the shot exists, such as `establish geography`,
     `carry interaction`, `deliver emotional peak`, or `punctuate key detail`.
   - Why it helps: tells the LLM the narrative job, not just the camera setup.
     This encourages creative shot solutions that still serve story.
   - Consistency risk: low. It does not contradict cast, style, or continuity.
   - Pare-back option: derive it deterministically and do not ask the LLM to
     author it in v1.

2. `coverage`
   - Today: partially implied by `shotSize`, `cameraSide`, `thirdPersonPov`,
     visible cast, and `sequenceRole`.
   - Add: a human-readable coverage intention such as `two-shot`,
     `listener reaction`, `over-the-shoulder`, `detail insert`, or
     `environmental aftermath`.
   - Why it helps: directly attacks repeated front-facing protagonist shots by
     naming the kind of coverage the panel needs.
   - Consistency risk: low to medium. Keep it subordinate to required/offscreen
     cast and third-person POV.
   - Pare-back option: start with only `two-shot`, `listener reaction`,
     `over-the-shoulder`, `detail insert`, and `wide geography`.

3. `varyFromPrevious`
   - Today: only implicit through `continuityFrom`, camera repetition checks,
     and prompt language about fresh composition.
   - Add: one sentence naming what should change from the previous panel:
     focal subject, shot scale, power balance, object focus, or emotional read.
   - Why it helps: gives the LLM permission to be creative while preserving the
     continuity link. This is the strongest anti-repetition field.
   - Consistency risk: low if phrased as "change this, preserve the packet's
     required cast/style/location."
   - Pare-back option: derive it only when validation detects repetition.

4. `avoid`
   - Today: many hard negatives exist in image prompts, but they are generic:
     no first-person POV, no text, no duplicate character, no static portrait,
     no copied reference-sheet pose.
   - Add: shot-specific avoid notes such as `front-facing portrait`,
     `neutral reaction`, `same camera as previous`, or `single protagonist alone`.
   - Why it helps: localizes the failure mode without bloating the global
     negative prompt.
   - Consistency risk: low if short. Avoid turning this into a long blacklist.
   - Pare-back option: only emit when a known pattern is detected.

### Medium Priority Additions

These are useful, but can wait until the first slice proves stable:

5. `relationshipFrame`
   - Today: relationship intent may appear in `sequenceRole`, beat text,
     `promptFields.action`, `promptFields.composition`, or `dramaticReason`, but
     it is not normalized.
   - Add: `confrontation`, `equality`, `power imbalance`, `solidarity`, or
     `separation within same space`.
   - Why it helps: improves two-shots and multi-character framing by telling the
     renderer what the shared frame means.
   - Consistency risk: low, but only useful when two or more characters are
     visible.
   - Pare-back option: derive only for two-shots and group shots.

6. `screenDirection`
   - Today: `cameraSide` and `continuityFrom` exist, but there is no explicit
     eyeline or movement direction note in the packet.
   - Add: compact notes like `Mira screen-left looks screen-right; Vale
     screen-right looks screen-left`.
   - Why it helps: preserves 180-degree rule and eyeline continuity in dialogue
     or movement sequences.
   - Consistency risk: medium. Bad inferred screen direction can confuse the
     renderer. Use it only when character positions are clear.
   - Pare-back option: warning-only in v1; do not inject into prompts unless
     high-confidence.

7. `mustShow`
   - Today: `promptFields.keyDetail` and beat `mustShowDetail` already cover
     this.
   - Add: likely not needed as a new packet field unless we want a clearer name.
   - Why it helps: mostly naming clarity.
   - Consistency risk: low.
   - Pare-back option: do not add; continue using `promptFields.keyDetail`.

### Lower Priority / Consider Later

These may be useful, but they are more likely to add complexity or over-control:

8. `storyFunction`
   - Today: partially covered by `dramaticReason`, `sequenceRole`, and
     `promptFields.action`.
   - Add: a sentence like "Vale realizes Mira lied and the power shifts."
   - Why it helps: rich creative direction.
   - Consistency risk: medium. It can duplicate or drift from existing beat
     action if not carefully derived.
   - Pare-back option: use `dramaticReason` for now and improve its content.

9. `shotIntent`
   - Today: partially covered by `promptFields.action` and `dramaticReason`.
   - Add: what the viewer should understand from the image.
   - Why it helps: good storyboard direction.
   - Consistency risk: medium due to overlap with `storyFunction`.
   - Pare-back option: skip in v1; let `shotPurpose + coverage +
     promptFields.action` carry this.

10. `continuityBreak`
    - Today: validation allows repeated camera only when `dramaticReason`
      mentions locked micro-progression, but there is no structured rule-break
      field.
    - Add: explicit rule and reason for breaking axis, eyeline, or screen
      direction.
    - Why it helps: supports intentional disorientation.
    - Consistency risk: medium to high. It opens the door to deliberate
      continuity violations.
    - Pare-back option: skip until we actually need cinematic rule-breaking.

11. Duplicated cast fields (`requiredVisible`, `optionalVisible`, `offscreen`)
    - Today: packet already has `requiredVisibleCharacterIds`,
      `optionalBackgroundCharacterIds`, and `offscreenCharacterIds`.
    - Add: no need.
    - Pare-back recommendation: do not add duplicate names. Improve the existing
      fields and maybe add display-name helpers only in diagnostics.

## Recommended Priority Order

Prioritize based on creative empowerment with low consistency risk:

1. Add derived `shotPurpose`.
2. Add derived `coverage`.
3. Add `varyFromPrevious` only when useful.
4. Add short shot-specific `avoid` notes.
5. Add `relationshipFrame` for two-shots/group shots.
6. Add `screenDirection` as warning-only/high-confidence metadata.
7. Revisit `storyFunction`, `shotIntent`, and `continuityBreak` later.

The smallest high-value slice is:

```ts
shotPurpose?: string;
coverage?: string;
varyFromPrevious?: string;
avoid?: string[];
```

This slice gives the LLM more creative direction while preserving the current
camera/cast/continuity context.

## Cinematography Rules Worth Borrowing

Use the cinematography compendium as lightweight shot-flow guidance, not as a
large rule engine:

- Wide/long shots establish geography and refresh the spatial map.
- Medium shots carry most dialogue and interaction.
- Close-ups are saved for emotional peaks, revelations, and decisive moments.
- Extreme close-ups punctuate critical details only.
- Two-shots should state the relationship meaning: confrontation, equality,
  power imbalance, solidarity, or separation within the same space.
- Over-the-shoulder coverage should vary psychological balance, not merely
  alternate angles.
- Protect the 180-degree rule, eyeline match, and screen direction unless a
  deliberate continuity break is declared.
- Use re-establishing shots when a scene runs long, characters move
  significantly, or geography becomes unclear.
- Each shot should have a reason for existing. Variety should come from
  narrative job, not randomness.

## What Not To Add In V1

Do not add lens math, focal-length prescriptions, detailed lighting setups,
exact x/y panel layout, strict pose anatomy, hard shot quotas, or a separate
`CinematographerAgent`.

Do not make the metadata so prescriptive that the image model loses its ability
to solve the shot creatively. The target is direction, not micromanagement.

## Skills And Agents

Do not add a new runtime agent for v1. Keep ownership with the existing
storyboard/image pipeline:

- Put shared types, defaults, validation, and sheet-mapping helpers in
  `src/ai-agents/images/visualStoryboardPlanning.ts`.
- Keep LLM prompt generation and any bounded repair inside `StoryboardAgent` or
  `ImageAgentTeam`.
- Keep `FullStoryPipeline.ts` changes limited to wiring, diagnostics, and
  prompt-contract handoff.

Useful helper names if the work grows:

```ts
buildDirectorBriefDefaults(...);
validateDirectorBriefHints(...);
repairStoryboardPacketShotVariety(...);
directorBriefToStoryboardPacket(...);
directorBriefToPromptContract(...);
```

Start with deterministic defaults and warnings. Add a bounded LLM repair only if
diagnostics show deterministic nudges are insufficient.

## Stage 1: Strengthen Existing Packet Metadata

Add a few optional fields to `StoryboardShotPacket`, but do not change downstream
behavior yet. Prefer the smallest high-value slice first:

```ts
shotPurpose?: string;
coverage?: string;
varyFromPrevious?: string;
avoid?: string[];
```

Add these later if the first slice is stable:

```ts
relationshipFrame?: string;
screenDirection?: string;
```

Populate these in `ImageAgentTeam.generateStoryboardPacket()` from the current
`VisualPlan` fields where possible. If missing, use simple deterministic defaults
from `sequenceRole`, `shotSize`, visible cast count, and previous shot.

This gives us observability first. We can inspect packet quality without
changing image generation.

Suggested deterministic defaults:

- `sequenceRole: establishing` -> `shotPurpose: establish geography`,
  `coverage: wide geography`.
- `sequenceRole: relationship` or two visible characters -> `shotPurpose: carry
  interaction`, `coverage: two-shot` or `medium interaction`.
- `sequenceRole: reaction` -> `shotPurpose: deliver emotional response`,
  `coverage: listener reaction`.
- `sequenceRole: insert` or `mustShowDetail` -> `shotPurpose: punctuate key
  detail`, `coverage: detail insert`.
- `sequenceRole: aftermath` -> `shotPurpose: refresh spatial map` or
  `environmental aftermath`, depending on visible cast.

Do not duplicate existing packet fields for cast or key detail. Reuse
`requiredVisibleCharacterIds`, `optionalBackgroundCharacterIds`,
`offscreenCharacterIds`, and `promptFields.keyDetail`.

## Stage 2: Improve Validation Without Blocking Too Much

Extend `validateVisualStoryboardPacket()` with warning-level diagnostics, not
hard failures at first:

- Repeated protagonist/front-facing solo shots.
- Three or more similar `shotSize + cameraAngle + cameraSide` runs.
- Too many close-ups without `sequenceRole` of `reaction`, `reversal`,
  `outcome`, or a strong emotional read.
- Missing variation note after repeated coverage.
- Dialogue runs without listener/reverse/OTS/two-shot variation.

Log these as warnings in diagnostics before making them fatal. This avoids
surprise regressions.

Use two severity buckets:

- `issues`: existing hard blockers that can break rendering or story mapping.
- `warnings`: shot-variety and cinematography concerns that should be inspected
  but should not block generation until proven stable.

## Stage 3: Add Deterministic Nudge Rules

Before calling any extra LLM repair, add cheap deterministic nudges in the packet
normalization step:

- If two consecutive dialogue shots are both solo/eye-level/front-ish, change the
  second packet's `coverage` suggestion to `listener reaction` or
  `over-the-shoulder`.
- If a scene opens tight and has four or more beats, suggest `wide geography` or
  `medium long relationship frame` for the opener unless the beat is clearly an
  emotional cold open.
- If close-ups are overused, demote later ones to `MCU` or `MS` unless they are a
  climax, revelation, or detail beat.
- If the protagonist has been focal for several beats, prefer an NPC reaction,
  prop insert, environmental aftermath, or two-shot.

These nudges modify planning metadata, not generated story content.

Nudges should be visible in diagnostics. Every nudge should record:

- Original field values.
- New field values.
- Reason for the nudge.
- Whether it was high-confidence or conservative.

## Stage 4: Feed New Fields Into Existing Prompt Contracts

Update `applyThirdPersonRenderContract()` to include the new optional packet
fields:

```text
Shot purpose: ...
Coverage: ...
Relationship frame: ...
Vary from previous: ...
Avoid: ...
Screen direction: ...
```

This is low-risk because final prompts already receive packet metadata. We are
just making the existing contract more useful.

Keep the prompt language soft:

> Use this as director guidance, not a rigid layout.

That protects creative flexibility.

The prompt contract should preserve the current packet details and append the
new fields. It should not override story action, required cast, style contract,
or third-person POV protections.

Suggested wording:

```text
DIRECTOR GUIDANCE (flexible, not a rigid layout):
Shot purpose: ...
Coverage: ...
Vary from previous: ...
Avoid: ...
Use this to choose a fresh composition while preserving the required cast,
story action, style, location, and third-person camera contract.
```

Only include `relationshipFrame` and `screenDirection` when populated and
high-confidence.

## Stage 5: Update Storyboard Sheet Prompts

Only after final beat prompts benefit, feed the same metadata into storyboard-v2
sheet prompts. The sheet prompt should emphasize sequence flow:

- Each panel has a different narrative job.
- Adjacent panels preserve continuity.
- Coverage varies according to packet notes.
- The sheet should not become unrelated hero images arranged together.

This is where the storyboard sheet starts becoming a sequence, while still using
the current packet and panel infrastructure.

This stage should wait until packet diagnostics show the new fields are reliable.
The sheet prompt should not ask the sheet model to invent new shot plans. It
should use the packet hints as direction and solve the visual arrangement inside
each panel creatively.

## Stage 6: Bounded LLM Repair, Only If Needed

Do not add a new agent. If warnings persist, add one bounded repair method inside
`StoryboardAgent` or `ImageAgentTeam`:

```ts
repairStoryboardPacketShotVariety(packet, issues)
```

It should repair only packet metadata for failed shots, not regenerate the whole
plan. Keep the existing shot action and required cast locked.

Use this only for clear failures like repeated front-facing protagonist shots or
broken dialogue coverage.

Repair instructions should preserve:

- Existing `beatId`, `slotId`, shot action, required cast, offscreen cast, and
  must-show details.
- Approved neighboring panel briefs.
- The current story function, unless the issue is that no distinct story
  function exists.

Repair instructions should ask for:

- A different coverage pattern when repetition is the issue.
- A continuity-safe alternative when screen direction or eyeline breaks.
- A less tight shot when close-ups are overused.

Do not add this repair loop until warning diagnostics show deterministic nudges
are insufficient. This keeps v1 cheap, debuggable, and less likely to regress.

## Stage 7: Promote Stable Warnings To Hard Failures

Once diagnostics show the new fields are stable, promote a small set of checks to
hard failures in `visual-storyboard` mode:

- Missing shot for beat.
- Invalid first-person POV.
- Missing required visible cast.
- Repeated exact camera plan without locked micro-progression.

Keep subjective artistry as warnings.

## Test Coverage

Add focused tests before broad validation:

- `visualStoryboardPlanning` tests for optional director fields, deterministic
  defaults, warning diagnostics, missing beats, missing cast, repeated
  protagonist-front coverage, invalid POV, unjustified close-up runs, and broken
  screen direction.
- Packet normalization tests proving the new fields can be derived without
  changing existing required packet shape.
- Prompt assembly tests confirming storyboard sheet prompts and final beat
  prompts receive the same director hints.
- Dialogue-scene tests confirming coverage rotates through geography,
  two-shot/medium interaction, OTS/listener reaction, insert, and aftermath.
- Repair tests only if bounded repair is added; they should prove only failed
  metadata changes and approved panels remain stable.

## Why This Is Safer

This approach does not remove the current `VisualPlan`,
`VisualStoryboardPacket`, storyboard-v2 prompts, third-person contract, or
existing packet validation. It layers better cinematographic intent onto what
already works.

The highest value, lowest risk first slice is:

1. Add `shotPurpose`, `coverage`, `varyFromPrevious`, and `avoid`.
2. Log variety warnings.
3. Feed those fields into `applyThirdPersonRenderContract()`.

That should reduce front-facing protagonist portrait drift without threatening
the rest of the pipeline.
