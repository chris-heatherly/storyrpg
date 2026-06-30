# Bite Me G24 - Remediation Plan (2026-06-19)

**Source audit:** `storyrpg-prototype/docs/BITE_ME_G24_AUDIT_2026-06-19.md`  
**Failed run:** `generated-stories/bite-me-g24_2026-06-19T16-33-48`  
**Worker job:** `worker-1781886687028-7uh7fvn6`  
**Planning baseline:** G24 already exercised several recent fixes. Treat its failure as evidence that the final-story contract now blocks bad packages, then use this plan to move the remaining defects earlier in the pipeline and make repair persistence trustworthy.

## Executive Summary

G24 is not a candidate package to salvage. It is a failed diagnostic artifact that usefully proves the pipeline no longer writes a playable `story.json` when final contract blockers remain.

The next round of work should focus on five outcomes:

1. Failed runs are inspectable from disk without reading worker timelines.
2. G24-style setup-skipping branches fail before expensive prose, encounter, and media generation.
3. Player-facing planning-register text is blocked and repaired deterministically.
4. Encounter prose, POV, outcome text, pronoun repair, and callback debt are either repaired or fail with precise reports.
5. Diagnostics match the runtime story shape: beat-level choices count as choices, branch metrics fail on path-causality defects, and partial failed runs are never treated as playable packages.

## Baseline Fixes Already Landed

These should be preserved and extended, not rebuilt:

- Final contract blocks bad packages; G24 failed honestly and did not write a reader package.
- Branch setup-skip detection exists in `FinalStoryContractValidator` and `SceneGraphBranchValidator`.
- Outcome text quality detection and the final-contract outcome repair path exist.
- `EncounterProseIntegrityValidator` exists and scans malformed second-person encounter residue, but `GATE_ENCOUNTER_PROSE_INTEGRITY` remains default-off.
- POV/pronoun coercion has recent safeguards for some name-as-modifier cases.
- Generated package writing already treats `story.json` as primary, with `manifest.json` and `08-final-story.json` as required package outputs only after final story save.

## Phase 1 - Failed-Run Artifacts And Repair Persistence

**Problem:** G24 saved only `99-pipeline-errors.json`, partial/checkpoint artifacts, and worker timeline details. The final contract report was not saved as a complete failed-run artifact, and the saved `partial-story.json` may not reflect final repair mutations.

**Implementation plan:**

- Before `FinalContract.enforceFinalStoryContract` throws, write `07b-final-story-contract.failed.json` into the run directory.
- Include:
  - `passed: false`
  - full `blockingIssues`
  - full `warnings`
  - `metrics`
  - `generatedAt`
  - final gate states relevant to findings
  - repair round count
  - repair records or compact repair summary
  - whether the saved partial is pre-repair or last-candidate
- Persist the last repaired story candidate to `partial-story.json` on terminal abort.
- If a pre-repair partial already exists, preserve it only when useful as `partial-story.pre-repair.json`.
- Add or extend failed-run ledger metadata with:
  - `failureKind: final_story_contract`
  - blocking issue type counts
  - failed contract path
  - final partial path
- Do not write `story.json`, `manifest.json`, or `08-final-story.json` on failure.

**Acceptance criteria:**

- A failed final-contract run can be audited from files inside its generated run directory.
- If logs say outcome repair or scene repair rewrote content, the final `partial-story.json` reflects those rewrites.
- `99-pipeline-errors.json` remains a summary, not the only source of structured failure truth.

**Tests:**

- Unit test final-contract failure serialization.
- Unit test that a repaired-but-still-failing candidate replaces `partial-story.json`.
- Unit test that no package files are written on final-contract failure.

## Phase 2 - Branch Path Continuity Before Prose Spend

**Problem:** G24 still generated prose and encounters for branches that jumped over required setup. Final contract caught the defect, but too late. Branch metrics also reported valid episodes.

**Implementation plan:**

- Move the existing setup-skip check into the earliest stable point after branch repair / bridge insertion.
- Reuse the same semantics as final contract:
  - a choice bridge that jumps more than one scene forward is suspect;
  - skipped encounter, bottleneck, convergence, choice-bearing, callback-bearing, or substantive prose scenes are required setup;
  - terminal sentinels such as `episode-end` remain valid endings.
- Make `SceneGraphBranchValidator` return `valid: false` when `path_missing_required_setup` exists.
- Require intentional skips to carry explicit continuity evidence, not just a boolean:
  - `allowSceneSkip: true`
  - `skipContinuitySummary`
  - `coveredRequiredSceneIds`
  - text or residue proving the skipped facts are carried into the alternate path
- If explicit continuity evidence is absent, route through the required setup scenes instead of generating the skip.
- Ensure branch metrics JSON records:
  - skipped scene ids
  - source scene id
  - target scene id
  - source choice id
  - whether skip was allowed or blocked

**Acceptance criteria:**

- The G24 paths from `s1-1` to `treatment-enc-1-1`, `s2-1` to `treatment-enc-2-1`, and `s3-1` to `treatment-enc-3-1` fail before scene prose, encounter prose, and media generation.
- `episode-*-branch-metrics.json` cannot report `valid: true` for a path that skips required setup.

**Tests:**

- Add a compact G24 fixture with the three setup-skipping bridge cases.
- Add positive fixture for an intentional connector skip with explicit continuity evidence.
- Run `npm test -- SceneGraphBranchValidator FinalStoryContractValidator`.

## Phase 3 - Planning-Register Prose Leak Prevention

**Problem:** G24 player-facing fields contain planning directives such as `Open the episode...`, `Introduce Stela Pavel on-page...`, `Authored treatment choice...`, and `Decide how to handle development scene 4.`

**Implementation plan:**

- Add `PlanningRegisterLeakValidator`.
- Scan player-facing and visual-facing prose fields:
  - scene beat `text`
  - `textVariants[].text`
  - choice text and outcome text
  - `visualMoment`
  - `visualNarrative`
  - `primaryAction`
  - `mustShowDetail`
  - encounter `description`
  - encounter phase beat prose
  - encounter outcome/storylet prose
- Block high-confidence planning-register phrases:
  - `Open the episode`
  - `Introduce .* on-page`
  - `Authored treatment choice`
  - `Escalate the episode's pressure`
  - `Decide how to handle`
  - `development scene`
  - `setup scene`
  - `serves the hook beat`
  - `serves the rising purpose`
- Run the validator:
  - immediately after scene writing;
  - after SceneCritic rewrites;
  - during final contract as a backstop.
- Route findings with a `sceneId` to scene-prose repair.
- Director note for repair: replace the planning instruction with dramatized second-person prose that preserves the same story purpose.

**Acceptance criteria:**

- G24 `s1-1` and `s3-4` planning-register text fails deterministically.
- A repaired scene cannot pass if any high-confidence planning directive remains in player-facing or visual-facing fields.

**Tests:**

- Unit test clean prose does not flag.
- Unit test every G24 leak phrase flags.
- Unit test nested encounter prose is scanned.
- Run `npm test -- PlanningRegisterLeakValidator FinalStoryContractValidator`.

## Phase 4 - Outcome Stub Detection And Persistence

**Problem:** G24 logs say outcome repair re-authored six stub tiers, but the saved `partial-story.json` still contained those stubs.

**Implementation plan:**

- Run `OutcomeTextQualityValidator` immediately after ChoiceAuthor output is merged into scene beats.
- Run it again after final-contract repair.
- Keep `GATE_OUTCOME_TEXT_QUALITY` blocking.
- When final-contract outcome repair changes a story that still fails later, persist the changed candidate to `partial-story.json`.
- Ensure final package writing cannot proceed if any known fallback outcome text remains.
- Add the exact G24 fallback strings to the fixture corpus:
  - `The room settles around the choice...`
  - `Ground gained, but not cleanly...`
  - `Not the way you hoped...`
  - `For once it goes your way...`
  - `It works, mostly...`
  - `You come back with less than you brought.`

**Acceptance criteria:**

- Stub outcome text is caught before final save.
- A failed run's saved partial matches the last repaired candidate.
- Repair logs and artifact contents cannot disagree.

**Tests:**

- Unit test G24 outcome strings flag as stubs.
- Unit test repair persistence when a different later blocker remains.
- Run `npm test -- OutcomeTextQualityValidator FinalStoryContractValidator`.

## Phase 5 - Encounter Prose And POV Hardening

**Problem:** G24 improved over G22, but malformed encounter residue remained in nested encounter fields: `You kiss you`, `You freez`, and third-person protagonist storylet text.

**Implementation plan:**

- Expand `EncounterProseIntegrityValidator` to collect every encounter field that can render or inform visuals:
  - `description`
  - phase beat `text`, `setupText`, `escalationText`
  - choice text
  - all outcome `narrativeText`
  - `nextSituation` prose
  - storylet beat text
  - cost text
  - visible complication text
  - visual contract prose
- Keep findings as warnings by default until repair proves stable.
- Add an explicit watched-run mode with `GATE_ENCOUNTER_PROSE_INTEGRITY=1`.
- Add deterministic micro-repair only for unambiguous typo-like cases:
  - `You freez` -> `You freeze`
  - `you <known noun>` -> prefer `your <noun>` only when the noun is a body/owned object; otherwise route to LLM repair.
- Route ambiguous corruption such as `You kiss you` to scene-prose repair rather than guessing.
- Ensure `sceneProseRepairHandler` merges encounter rewrites back into:
  - phase beats
  - outcome prose
  - storylet beats
  - cost fields
  - visual contract fields
- Keep `GATE_ENCOUNTER_POV` enabled for high-confidence third-person protagonist narration.
- Add tests for third-person encounter descriptions and storylets:
  - `Kylie decides...`
  - `Kylie's phone buzzes...`
  - `Kylie twists out of his orbit...`

**Acceptance criteria:**

- With `GATE_ENCOUNTER_PROSE_INTEGRITY=1`, G24 encounter residue blocks final pass.
- Repair either clears nested residue or leaves a failed final-contract artifact naming the exact nested fields.
- No malformed second-person encounter strings appear in a passing package.

**Tests:**

- Unit tests for nested encounter string traversal.
- Unit tests for malformed-you patterns and clean second-person phrasing.
- Unit tests for encounter POV blockers.
- Run `npm test -- EncounterProseIntegrityValidator FinalStoryContractValidator PovClarityValidator`.

## Phase 6 - Pronoun Repair Safety

**Problem:** G24 showed malformed pronoun repair artifacts such as `him eyes`, `him forehead`, and `him laptop`. Some NPC pronoun warnings are also false positives when the pronoun refers to someone else.

**Implementation plan:**

- Add regression tests for:
  - `Kylie Marinescu freezes mid-toast, him eyes fixed...`
  - `Kylie Marinescu leans him forehead...`
  - `Kylie Marinescu sits before him open laptop...`
  - `A close-up of Kylie Marinescu's hands typing on him laptop...`
- Update protagonist coercion to reject or repair impossible possessive/object artifacts.
- Add a post-coercion sanity scan for malformed pronoun-object pairs.
- Keep broad NPC pronoun findings advisory until an LLM or deterministic coreference judge confirms the pronoun binds to the named NPC.
- Add a future `NpcPronounCoreferenceJudge` before promoting `GATE_NPC_PRONOUN`.
- Confirm protagonist POV repair remains separate from NPC pronoun advisory checks.

**Acceptance criteria:**

- Pronoun repair cannot create `him eyes`, `him forehead`, or `him laptop`.
- Confirmed protagonist POV/pronoun errors still block or repair.
- NPC pronoun warnings do not abort a season unless confirmed by a coreference-aware path.

**Tests:**

- Run `npm test -- PovClarityValidator protagonistPronounResolver npcPronounResolver FinalStoryContractValidator`.
- Add fixture assertions for G24 malformed pronoun output.

## Phase 7 - Callback And Flag Economy

**Problem:** G24 retained callback debt: an unset condition flag, many write-only flags, and choice flags not referenced by text variants.

**Implementation plan:**

- Make `FlagContractValidator` and callback validation ledger-aware.
- Partition flags into:
  - consumed in generated range;
  - explicitly future-windowed;
  - true orphan setter;
  - unset read;
  - intentionally diagnostic/internal.
- Add `futureWindow` metadata for flags meant to pay off outside the generated episode range.
- For treatment-sourced slices, require structural and dilemma choices to have at least one in-range acknowledgment unless explicitly future-windowed.
- Add textVariant repair for important in-range dead flags.
- Normalize flag vocabulary before validation to prevent unset read variants such as `accepted_victor_invitation_ep2`.
- Preserve advisory handling for harmless flavor flags, but keep treatment-sourced silent structural choices blocking.

**Acceptance criteria:**

- G24-style `accepted_victor_invitation_ep2` unset reads are caught with a specific fix suggestion.
- In-range structural choices cannot silently vanish.
- Future-window flags are allowed only when marked and explained.

**Tests:**

- Unit tests for set/read/future-window partitioning.
- Fixture test for G24 callback debt.
- Run `npm test -- CallbackOpportunitiesValidator FlagContractValidator FinalStoryContractValidator`.

## Phase 8 - Beat-Level Choice Diagnostics

**Problem:** G24 diagnostics warned that scenes authored no choices even though choices existed under `scene.beats[].choices`.

**Implementation plan:**

- Update choice coverage diagnostics to count:
  - scene-level choices, if any legacy stories still use them;
  - beat-level choices in `scene.beats[].choices`;
  - encounter choices separately.
- Report planned-vs-authored choice coverage per scene with the correct runtime shape.
- Change warning text to identify missing planned choice only when neither scene-level nor beat-level choices exist.
- Add diagnostics output fields:
  - `plannedChoicePoint`
  - `beatChoiceCount`
  - `sceneChoiceCount`
  - `encounterChoiceCount`
  - `coverageStatus`

**Acceptance criteria:**

- G24-style scenes with beat-level choices no longer warn as empty.
- Truly missing choice-point scenes still warn.

**Tests:**

- Unit tests for beat-level choice detection.
- Fixture test using G24 scene shape.
- Run `npm test -- choice_coverage narrative diagnostics`.

## Phase 9 - Skill Balance And Encounter Skill Coverage

**Problem:** G24 was still too persuasion/perception-heavy, especially in episodes 2 and 3, and had no hard checks in the saved partial.

**Implementation plan:**

- Add per-episode skill rebalance before final contract.
- Include both normal beat choices and encounter choices in skill distribution.
- Cap dominant skill share at 40 percent unless the season skill plan explicitly allows a higher cap for that episode.
- Prefer reassigning excess checks to skills already planned for the episode.
- Do not change visible choice prose unless the skill no longer matches the action.
- Add hard-check expectations from the season plan where present.
- Keep all mechanics fiction-first; no visible stats, thresholds, or rolls.

**Acceptance criteria:**

- Episodes cannot ship with persuasion/perception near 50 percent dominance unless explicitly justified by plan metadata.
- Encounter choices count toward skill distribution.
- Rebalanced skills remain plausible for the choice text.

**Tests:**

- Unit tests for per-episode skill rebalance.
- Unit tests including encounter skill checks.
- Run `npm test -- SkillPlanConformanceValidator skillPlanRebalance FinalStoryContractValidator`.

## Phase 10 - Media And Package Semantics

**Problem:** G24 had no images or package because it failed final contract. That is correct, but the artifact should be clearly treated as diagnostic-only.

**Implementation plan:**

- Keep image generation and asset validation downstream of final story contract pass.
- Ensure failed partials are excluded from catalog and reader-visible package listings.
- Mark failed runs as diagnostic artifacts in worker/job state and generated run metadata.
- On successful runs, keep the package contract:
  - `story.json`
  - `manifest.json`
  - `08-final-story.json`
- Do not run `validate:assets` against failed diagnostic-only directories unless a specific diagnostic mode is added.

**Acceptance criteria:**

- Failed G24-style runs never appear as playable stories.
- Successful runs always write the modern and legacy package files.
- Asset validation is reserved for completed packages or explicit diagnostic mode.

**Tests:**

- Unit tests for catalog exclusion of failed partials.
- Unit tests for package write success path.
- Run `npm test -- storyLibrary storyCatalog storyCodec pipelineOutputWriter`.

## Suggested Implementation Order

1. Phase 1: failed-contract artifact save and repaired partial persistence.
2. Phase 3: planning-register prose validator, because it is high-signal and cheap.
3. Phase 2: early branch continuity and branch metrics correction.
4. Phase 4: outcome stub persistence and post-repair validation.
5. Phase 5: encounter prose traversal and watched repair mode.
6. Phase 6: pronoun repair safety tests and post-coercion guard.
7. Phase 8: beat-level choice diagnostics.
8. Phase 7: callback and flag economy.
9. Phase 9: per-episode and encounter skill balance.
10. Phase 10: catalog/package semantics polish and final verification.

This order maximizes cheap deterministic wins first, then moves into repair-heavy and generation-sensitive work.

## Test Plan

Run focused tests as each phase lands:

```bash
npm test -- FinalStoryContractValidator
npm test -- SceneGraphBranchValidator
npm test -- EncounterProseIntegrityValidator
npm test -- PovClarityValidator
npm test -- OutcomeTextQualityValidator
npm test -- CallbackOpportunitiesValidator FlagContractValidator
npm test -- storyLibrary storyCatalog storyCodec pipelineOutputWriter
```

Run integration checks after phases 1-6:

```bash
npm test -- FinalStoryContractValidator SceneGraphBranchValidator EncounterProseIntegrityValidator PovClarityValidator
npm run typecheck
```

Run a watched Bite Me three-episode generation after phases 1-6:

- If the run aborts, inspect `07b-final-story-contract.failed.json`, `partial-story.json`, branch metrics, callback ledger, and worker state.
- If the run passes, inspect `story.json`, `manifest.json`, `08-final-story.json`, `07b-final-story-contract.json`, branch metrics, callback ledger, and reader catalog visibility.
- Confirm no package files are written on final-contract failure.

## G24 Fixture Requirements

Add a compact fixture derived from G24, not the full generated artifact. The fixture should include:

- one setup-skipping branch bridge;
- one scene with planning-register beat prose;
- one encounter with malformed second-person residue;
- one encounter or storylet with third-person protagonist narration;
- one choice with fallback outcome text;
- one unset condition flag;
- one write-only structural choice flag;
- one scene with beat-level choices that diagnostics must count correctly.

Keep the fixture small enough for fast validator tests and avoid embedding generated images or large base64 payloads.

## Assumptions And Defaults

- This plan is a roadmap for pipeline fixes, not a request to edit generated G24 artifacts.
- `BITE_ME_G24_AUDIT_2026-06-19.md` remains the source audit.
- `BITE_ME_G24_REMEDIATION_PLAN_2026-06-19.md` is the standalone implementation plan.
- Keep markdown ASCII-only.
- Do not flip `GATE_ENCOUNTER_PROSE_INTEGRITY` default-on until a watched run proves nested encounter repair can clear real residue.
- Treat G24 as a failed diagnostic artifact, not a story to hand-repair into the reader catalog.
