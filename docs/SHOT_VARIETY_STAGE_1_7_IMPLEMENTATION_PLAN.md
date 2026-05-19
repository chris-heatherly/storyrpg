# Shot Variety Stage 1-7 Implementation Plan

This plan implements the full staged shot-variety upgrade through Stage 7. It
does not use the earlier pare-back path: add the complete director-direction
field set, wire it through packets, validation, prompt contracts, storyboard
sheets, bounded repair, and final hard-failure promotion.

## Core Goal

Improve shot variety and storyboard-sheet flow without replacing the existing
pipeline. Keep `VisualPlan`, `VisualStoryboardPacket`, storyboard-v2 rendering,
third-person POV protections, reference handling, and final prompt generation
intact.

The new fields should become the authoritative source for cinematographic
direction. Prompt text elsewhere must not duplicate or contradict these fields.

## Direction Authority Rule

For shot direction, coverage, screen direction, relationship framing, and
variation from the previous panel:

- Use the new packet fields as the single source of truth.
- Do not emit competing camera/coverage/continuity instructions elsewhere in the
  prompt.
- Existing prompt builders may still describe story action, required cast,
  style, location, mood, references, and third-person POV protections.
- If an older prompt section currently says things like "fresh composition",
  "three-quarter", "eye-level", "medium shot", "centered", "rule of thirds",
  "do not repeat previous camera", or "vary staging", it should either be
  removed, softened, or rewritten to defer to the packet direction fields.
- If deterministic fallback must synthesize direction, write it into the packet
  fields first, then render from those fields.

Suggested prompt language:

```text
DIRECTOR GUIDANCE (authoritative for shot direction):
Shot purpose: ...
Coverage: ...
Relationship frame: ...
Screen direction: ...
Continuity from previous: ...
Vary from previous: ...
Avoid: ...

Use these fields for camera, coverage, staging relationship, and continuity.
Do not invent alternate shot direction that conflicts with them. Solve exact
pose, expression, and composition creatively within this direction.
```

## Fields To Add

Extend `StoryboardShotPacket` with optional director-direction fields:

```ts
shotPurpose?: string;
coverage?: string;
relationshipFrame?: string;
storyFunction?: string;
shotIntent?: string;
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

Do not duplicate cast fields. Continue using:

- `requiredVisibleCharacterIds`
- `optionalBackgroundCharacterIds`
- `offscreenCharacterIds`

Do not duplicate existing key-detail storage unless needed for prompt clarity.
Map `mustShow` from `promptFields.keyDetail` / beat `mustShowDetail`, and keep
those values synchronized.

## Stage 1: Packet Metadata

Update `visualStoryboardPlanning.ts`:

- Add the new optional fields to `StoryboardShotPacket`.
- Add helper types for known values where useful, but keep packet fields string-
  compatible enough to avoid migration brittleness.
- Add helpers to derive defaults:
  - `deriveShotPurpose(...)`
  - `deriveCoverage(...)`
  - `deriveRelationshipFrame(...)`
  - `deriveVaryFromPrevious(...)`
  - `deriveScreenDirection(...)`
  - `deriveAvoidNotes(...)`

Update `ImageAgentTeam.generateStoryboardPacket()`:

- Normalize every shot through the new helper before packet validation.
- Derive missing director fields from `sequenceRole`, `shotSize`, `cameraAngle`,
  `cameraSide`, `thirdPersonPov`, visible cast count, `promptFields`, and the
  previous shot.
- Persist derived fields in the saved packet diagnostics.

## Stage 2: Validation And Warnings

Extend `validateVisualStoryboardPacket()` to return or include warning-level
diagnostics in addition to hard issues.

Hard issues should continue to include:

- Missing packet mode / invalid mode.
- Missing third-person camera rule.
- Empty shots.
- Missing beat id.
- Invalid first-person/subjective POV.
- Missing shot for a required beat.

Warnings should include:

- Repeated protagonist/front-facing solo shots.
- Three or more similar `shotSize + cameraAngle + cameraSide` runs.
- Too many close-ups without emotional/revelation/detail justification.
- Missing `varyFromPrevious` after repeated coverage.
- Dialogue runs without listener/reverse/OTS/two-shot variation.
- Missing `shotPurpose`, `coverage`, or `shotIntent`.
- Missing `relationshipFrame` on two-character or group relationship shots.
- Screen-direction ambiguity in dialogue or movement scenes.
- `avoid` notes missing when a known repeated pattern is detected.

Keep warnings non-blocking until Stage 7.

## Stage 3: Deterministic Nudges

Add deterministic packet-level nudges before prompt assembly:

- If two consecutive dialogue shots are both solo/eye-level/front-ish, change the
  later `coverage` to `listener reaction` or `over-the-shoulder`.
- If a scene opens tight and has four or more beats, set opener direction toward
  `wide geography` or `medium long relationship frame` unless it is clearly an
  emotional cold open.
- If close-ups are overused, nudge later non-peak shots to `MCU` or `MS`.
- If the protagonist has been focal for several beats, prefer NPC reaction, prop
  insert, environmental aftermath, or two-shot.
- If `cameraSide`/`screenDirection` is ambiguous, prefer preserving the existing
  axis over inventing a new one.

Every nudge must record diagnostics:

- Original values.
- New values.
- Reason.
- Confidence.

Nudges should update packet fields first. Prompt builders should read the final
packet fields only.

## Stage 4: Final Beat Prompt Contract

Update `FullStoryPipeline.applyThirdPersonRenderContract()`:

- Append the director-direction block using the new packet fields.
- Treat this block as authoritative for camera, coverage, relationship framing,
  screen direction, continuity, and variation.
- Keep third-person POV contract, environment style lock, required/offscreen
  cast, action, emotional read, and key detail.

Prompt de-duplication requirements:

- Do not emit separate generic camera advice that conflicts with
  `shotPurpose`, `coverage`, `screenDirection`, or `varyFromPrevious`.
- If `shotDescription`, `cameraAngle`, or `composition` already contains stale
  direction from deterministic prompt building, reconcile it before final prompt
  assembly.
- The final prompt may include technical camera fields only when they agree with
  the packet direction.
- Prefer phrases like "within the director guidance above" over adding another
  independent coverage instruction.

## Stage 5: Storyboard Sheet Prompts

Update storyboard-v2 sheet prompt assembly to consume the same packet fields:

- Each panel should receive its director direction.
- The sheet prompt should preserve panel order and continuity links.
- The sheet model should not invent alternate shot plans.
- The sheet should read as a sequence, not unrelated hero images arranged
  together.

Prompt de-duplication requirements:

- Remove generic sheet-level instructions that mandate a different camera rhythm
  than the packet.
- Keep sheet-level instructions focused on style consistency, panel order,
  continuity, no text, no broken panel count, and no accidental collage defects.
- If sheet-level prose mentions "vary shots", it must defer to the packet:
  "vary according to each panel's director guidance."

## Stage 6: Bounded Metadata Repair

Add a bounded repair method inside `StoryboardAgent` or `ImageAgentTeam`, not a
new runtime agent:

```ts
repairStoryboardPacketShotVariety(packet, issues)
```

Repair only failed packet metadata. Do not regenerate the whole `VisualPlan` and
do not rewrite story content.

Repair must preserve:

- `beatId`
- `slotId`
- `promptFields.action`
- `promptFields.emotionalRead`
- `promptFields.keyDetail`
- required/offscreen cast
- style/location/third-person contract
- approved neighboring panels

Repair may change:

- `shotPurpose`
- `coverage`
- `relationshipFrame`
- `shotIntent`
- `continuityFromPrevious`
- `varyFromPrevious`
- `screenDirection`
- `avoid`
- camera fields only when needed to align with repaired direction

Use bounded attempts and save diagnostics for each repair pass. If repair fails,
fall back to current text-plan rendering with an explicit diagnostic.

## Stage 7: Promote Stable Checks To Hard Failures

After warnings and nudges have been observed in diagnostics, promote stable
checks to hard failures in `visual-storyboard` mode:

- Missing shot for beat.
- Invalid first-person/player-eye POV.
- Missing required visible cast.
- Repeated exact camera plan without locked micro-progression.
- Missing authoritative direction fields after normalization.
- Direction-field contradictions, such as `coverage: over-the-shoulder` with
  `thirdPersonPov: observer` and no foreground shoulder/observer framing note.

Keep subjective artistry as warnings:

- Whether a shot is beautiful.
- Whether the exact pose is optimal.
- Whether lighting nuance is ideal.
- Whether the composition is the best possible version.

## Tests

Add focused tests before broad validation:

- `visualStoryboardPlanning` tests for new fields, deterministic derivation,
  warning diagnostics, missing beats, missing cast, repeated protagonist-front
  coverage, invalid POV, unjustified close-up runs, and broken screen direction.
- Packet normalization tests proving new fields can be derived while preserving
  existing required packet shape.
- Nudge tests proving repeated coverage is redirected through packet metadata
  and diagnostics are recorded.
- Prompt assembly tests proving final beat prompts include the director block
  and do not duplicate conflicting camera/coverage direction elsewhere.
- Storyboard sheet prompt tests proving sheet prompts consume packet direction
  and defer generic variety instructions to those fields.
- Repair tests proving only failed metadata changes and approved story/cast
  fields remain stable.

## Implementation Order

1. Add packet fields and helper derivation functions.
2. Normalize packets and persist new fields in diagnostics.
3. Add warning diagnostics.
4. Add deterministic nudges.
5. Wire fields into final beat prompt contract with de-duplication.
6. Wire fields into storyboard sheet prompts with de-duplication.
7. Add bounded metadata repair.
8. Promote stable warnings to hard failures.

## Success Criteria

- Generated packet diagnostics show explicit shot purpose, coverage, variation,
  relationship framing, screen direction, and avoid notes.
- Final prompts get shot direction from the packet fields, not scattered generic
  prompt language.
- Storyboard sheets read more like narrative sequences.
- Repeated front-facing protagonist shots decrease.
- Existing story action, character consistency, style consistency, and
  third-person POV protections do not regress.
