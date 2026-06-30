# Bite Me Ep 1 Encounter Ownership Remediation Plan

## Status

Paused because the remaining Bite Me Episode 1 blocker is an ownership-contract problem across the generation pipeline, not a safe one-file repair.

The latest run reached final story contract validation at:

`storyrpg-prototype/generated-stories/bite-me_2026-06-20T01-10-56`

Earlier blockers around truncation, deterministic schemas, one-choice placeholder output, invalid final routes, invalid branch skips, and Gemini schema constraints have been fixed with targeted patches. The current unresolved major issue is that the same rooftop/Cismigiu sequence is being represented twice:

- `s1-3` and `s1-4` dramatize the rooftop bar, Victor's gaze, the Cismigiu attack, the rescue, the 4 AM blog post, and the viral Mr. Midnight launch.
- `treatment-enc-1-1` is also inserted after `s1-4` as a separate encounter scene, but its description is a summary of those same events.
- The generated encounter artifact for `treatment-enc-1-1` is effectively hollow: `beats: [{ "id": "beat-1" }]`.
- Continuity QA correctly flags this as a structural timeline impossibility, because the separate encounter scene repeats events that have already happened.

## Evidence

Latest final blockers included:

- `continuity_error`: `treatment-enc-1-1` describes events already depicted in `s1-3` and `s1-4`.
- `encounter_pov_break`: final contract scans the encounter scene summary as player-facing prose and sees third-person protagonist narration.
- `qa_blocker_present`: QA report did not pass due continuity.

Blueprint evidence:

```json
{
  "id": "s1-4",
  "leadsTo": ["treatment-enc-1-1"]
}
```

```json
{
  "id": "treatment-enc-1-1",
  "isEncounter": true,
  "encounterType": "romantic",
  "description": "Two anchors, light then dark - the rooftop bar at sunset... then Cismigiu at 1am..."
}
```

Assembled episode evidence:

- `s1-3` already contains rooftop bar / Victor gaze material.
- `s1-4` already contains Cismigiu attack, Victor rescue, hand kiss, 4 AM blog post, and the viral Mr. Midnight count.
- `treatment-enc-1-1` appears after `s1-4` with no beats.

## Why This Is Major

Suppressing the final blocker by filtering `treatment-enc-1-1` at final packaging would violate the quality-standard direction that final assembly should be bundling, not late surgery.

The root problem crosses these boundaries:

- `SeasonPlannerAgent.mergeTreatmentGuidanceIntoPlanData` turns treatment encounter anchors into `plannedEncounters`.
- `StoryArchitect.buildBlueprintFromPlannedScenes` / `repairPlannedEncounterCoverage` must decide whether an encounter is a standalone scene or an overlay on an already planned scene.
- `ContentGenerationPhase` skips `SceneWriter` for encounter scenes and expects `EncounterArchitect` to provide all content.
- `EncounterArchitect` currently produced a hollow artifact for this case, which means incremental encounter validation did not catch enough.
- `ContinuityChecker` and `FinalStoryContractValidator` later discover the structural contradiction.

Changing only one of those layers risks either hiding the duplicate scene, dropping the treatment anchor, or weakening encounter validation.

## Remediation Goals

1. A treatment anchor must have exactly one owner in the episode artifact.
2. If the anchor is a standalone playable encounter, regular scenes must build toward it and not already depict its core events.
3. If the anchor is already depicted by normal scenes, the encounter contract must attach as metadata/validation pressure to those scenes, not create a second empty scene.
4. Encounter content must be validated during episode generation. A hollow encounter must fail immediately.
5. Final contract should only verify and bundle. It should not remove, merge, or rewrite completed episode structure.

## Proposed Design

### 1. Add Deterministic Encounter Ownership Classification

Add a pure classifier before blueprint finalization:

`classifyPlannedEncounterOwnership(plannedEncounter, plannedScenes)`

It should return one of:

- `standalone_scene`: planned encounter needs its own scene.
- `scene_overlay`: planned encounter is already represented by one or more planned standard scenes.
- `invalid_ambiguous`: the pipeline cannot safely determine ownership and must fail early with an actionable error.

Inputs should be deterministic:

- planned encounter description, stakes, required beats, NPCs, location/time markers
- planned scene dramatic purposes, required beats, signatures, locations, order
- treatment guidance episode turns and encounter anchors

No LLM should decide the ownership classification.

### 2. Bind Overlay Encounters To Scene Ranges

For `scene_overlay`, add an explicit blueprint field:

```ts
encounterOverlay?: {
  plannedEncounterId: string;
  coveredBySceneIds: string[];
  requiredBeats: string[];
  validationMode: 'scene_prose';
}
```

This allows validators to confirm that the treatment encounter anchor is present without inserting a duplicate scene.

### 3. Prevent Duplicate Encounter Scenes

In `StoryArchitect`, when a planned encounter is classified as `scene_overlay`:

- do not mark a separate `isEncounter` scene
- do not route normal scene `leadsTo` through a synthetic `treatment-enc-*` scene
- attach overlay metadata to the owning scene or scene range
- include the encounter's required beats in the owning scenes' `requiredBeats`, `keyBeats`, and validation context

For Bite Me Ep 1, the classifier should likely bind the anchor to `s1-3` and `s1-4`, not create `treatment-enc-1-1`.

### 4. Strengthen Incremental Encounter Validation

If a scene remains `isEncounter: true`, `ContentGenerationPhase` must fail immediately when:

- `EncounterArchitect` returns zero narrative beats
- any encounter beat has no player-facing text/setup/outcome prose
- the encounter scene reaches assembly with an empty `beats` array and no rendered encounter tree

This prevents hollow encounter artifacts from surviving to final validation.

### 5. Teach Continuity QA About Overlay Ownership

`ContinuityChecker` should treat overlay-owned encounters as coverage requirements, not timeline entries.

Expected behavior:

- standalone encounters appear in the ordered timeline
- overlay encounters are validated against their owning scene IDs
- duplicate-summary scenes fail during blueprint validation, not final packaging

### 6. Add Focused Regression Tests

Add tests for:

- Bite Me style anchor that mentions rooftop plus park, with planned scenes already covering those events, classifies as `scene_overlay`.
- Scene-overlay encounter does not create a `treatment-enc-*` scene.
- Hollow standalone encounter fails during content generation.
- Continuity timeline does not include overlay encounter as a separate scene.
- Final contract no longer sees encounter summary text as player-facing prose.

## Implementation Slices

1. Add pure classifier and tests.
2. Add `encounterOverlay` type support in blueprint types and StoryArchitect output normalization.
3. Update StoryArchitect planned encounter binding to use the classifier.
4. Update ContentGenerationPhase to enforce non-hollow standalone encounters.
5. Update continuity/final validation to respect overlay ownership.
6. Regenerate Bite Me Ep 1 and audit against `STORYRPG_QUALITY_STANDARD.md` plus the treatment.

## Acceptance Criteria

Bite Me Episode 1 is clean only when:

- no `treatment-enc-1-1` duplicate scene appears after the park/blog sequence unless it contains a real new playable event
- rooftop and Cismigiu beats appear once in the ordered timeline
- encounter anchor coverage is validated before final packaging
- no hollow encounter artifacts are written as completed units
- final story contract has no blockers or majors
- treatment beats remain present: Bucharest arrival, Sadie vampire joke, Dusk Club, quartz, Vâlcescu Club/key card pressure, rooftop Victor/Radu signals, Cismigiu attack/rescue, 4 AM blog launch, Mr. Midnight viral count, black roses/card, Stela nightmare/herbs cliffhanger

## Non-Goals

- Do not refactor the full pipeline orchestration.
- Do not weaken final validation.
- Do not remove encounter generation globally.
- Do not hide duplicate encounters during final packaging.
- Do not make Bite Me specific string hacks.

