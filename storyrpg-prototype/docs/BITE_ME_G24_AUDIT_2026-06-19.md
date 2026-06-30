# Bite Me G24 - Audit vs Storytelling / Gameplay / Branching Rules

**Run:** `generated-stories/bite-me-g24_2026-06-19T16-33-48`  
**Worker job:** `worker-1781886687028-7uh7fvn6`  
**Status:** failed at final story contract on 2026-06-19T18:05:36Z.  
**Package status:** no `story.json`, no `manifest.json`, no `08-final-story.json`; only `partial-story.json`, checkpoints, diagnostics, and `99-pipeline-errors.json`.

## Verdict

**Not shippable, and not a completed package.** G24 is useful as a pipeline audit because it shows the final contract doing the right thing: it refused to save a story that still had path-continuity, POV, and unrepaired incremental-validation defects. That is a real improvement over G22, whose final metadata claimed pass despite player-facing blockers.

The partial story itself should not be promoted or hand-repaired into the library. It still contains planning-register prose in player beats, branch bridges that skip required setup, fallback outcome text, remaining encounter rewrite residue, pronoun drift, callback debt, and no rendered images.

## What Improved

- **Final gating is honest.** The worker failed with `Final story contract failed with 9 blocking issue(s)`, and no reader package was written.
- **Some deterministic repair ran.** The final repair loop rewrote scene prose in `s1-4`, `s2-2`, and `s3-4`; it also re-authored 6 stub outcome tiers across 2 choices before the final failure.
- **The worst G22 encounter rewrite pattern is reduced in normal story beats.** A direct scan of saved `partial-story.json` found no top-level `you rooftop` / `you bar` / `you hedge`-style hits. The residue is now concentrated in encounter structures and outcome/storylet text.
- **Beat id collisions appear repaired in the saved partial.** Earlier incremental reports still list duplicate beat ids, but the saved `partial-story.json` has no duplicate beat ids across the three episodes.

## Blockers

### B1. This run did not produce a playable story package

The generated directory has 84 files, but the modern and legacy playable package files are absent:

- missing `story.json`
- missing `manifest.json`
- missing `08-final-story.json`

Only `partial-story.json` exists. The worker and `99-pipeline-errors.json` agree that the run failed at final contract.

### B2. Branch bridges still skip required setup scenes

The final contract's saved report data lists three blocking `choice_bridge_skips_required_setup` findings:

- Ep1: `s1-1__beat-3-bridge-choice-2` jumps from `s1-1` to `treatment-enc-1-1`, skipping `s1-2`, `s1-3`, and `s1-4`.
- Ep2: `s2-1-b3-bridge-choice-1` jumps from `s2-1` to `treatment-enc-2-1`, skipping `s2-2`, `s2-3`, and `s2-4`.
- Ep3: `s3-1__beat-7-bridge-choice-2` jumps from `s3-1` to `treatment-enc-3-1`, skipping `s3-2`, `s3-3`, and `s3-4`.

These are not cosmetic graph quirks. They route the player around the episode's setup and then into encounters or bottlenecks that assume the skipped material already happened.

### B3. Encounter POV remains broken

The final contract blocked all three encounter scenes for third-person protagonist narration:

- Ep1 encounter: rooftop/Cismigiu description narrates "Kylie catches both men watching her."
- Ep2 encounter: Victor club description says "a back-room door she clocks exactly once."
- Ep3 encounter: hedge maze description says "the kiss where Kylie decides..."

This violates the second-person reader contract and keeps the encounter layer from feeling like player-authored action.

### B4. Incremental validation failures survived final repair

The final failure includes three `failed_incremental_validation` blockers:

- `setup scene 1`
- `development scene 3`
- `development scene 4`

This matters because G24's saved partial still contains player-facing planning prose in those areas:

- Ep1 `s1-1__beat-1`: `Open the episode and plant its question...`
- Ep1 `s1-1__beat-2`: `Introduce Stela Pavel on-page...`
- Ep1 `s1-1__beat-3`: `Authored treatment choice...`
- Ep3 `s3-4__beat-1`: `Escalate the episode's pressure...`
- Ep3 `s3-4__beat-2`: `The pressure tightens as the scene drives toward Decide how to handle development scene 4.`
- Ep3 `s3-4__beat-3`: `Decide how to handle development scene 4.`

Those are design instructions leaking into story text.

### B5. A current validator replay still fails the saved partial

I replayed `FinalStoryContractValidator` directly against `partial-story.json`. Because the failed worker did not save the full final report inputs, this replay is not a perfect reproduction of the worker's treatment-fidelity context, but it is a useful current-state scan of the artifact on disk.

Replay result:

- `passed: false`
- 3 episodes checked
- 18 scenes checked
- 122 beats checked
- 3 encounter scenes checked
- 10 current blocking issues

Current blocking issue types:

- 6 `outcome_text_stub` errors in ep3 scene `s3-3`
- 3 `choice_bridge_skips_required_setup` errors
- 1 `unrepaired_callback_debt` error: 24 set flags never referenced in text variants

### B6. ChoiceAuthor fallback text is still visible in ep3

The saved partial contains generic fallback outcome text for `s3-3-b7-c1` and `auto-choice-2`, including:

- `The room settles around the choice, and it lands the way you meant it to.`
- `Ground gained, but not cleanly; the cost settles in behind it.`
- `Not the way you hoped - and the difference is yours to hold.`
- `For once it goes your way, a little cleaner than you expected.`
- `It works, mostly, though something slips loose in the doing and you notice.`
- `You come back with less than you brought.`

The final repair log says it re-authored 6 stub tiers across 2 choices, but the saved `partial-story.json` still contains the stubs. Either the repair did not persist back to the partial artifact, or the replay is seeing a pre-repair partial snapshot.

### B7. Encounter rewrite residue still exists

The direct validator replay reports encounter-prose warnings for `treatment-enc-3-1`:

- `You kiss you, and you respond with startling intensity, pulling you flush against you...`
- `You freez, just for a fraction of a second...`

The partial also contains third-person encounter/storylet text such as:

- `Kylie's phone buzzes in her pocket...`
- `Kylie twists out of his orbit...`

So G24 improves over G22's widespread malformed second person, but the underlying encounter rewrite bug is not fixed.

## Major Findings

### M1. The branch metrics are still blind to path-continuity defects

All three `episode-*-branch-metrics.json` files report `valid: true` and `issues: 0`:

- Ep1: `12 choices, 9 scene branches, 1 encounters, 4 encounter choices, 4 storylets`
- Ep2: `13 choices, 10 scene branches, 1 encounters, 4 encounter choices, 4 storylets`
- Ep3: `11 choices, 6 scene branches, 1 encounters, 4 encounter choices, 4 storylets`

The final contract catches the setup-skipping bridges, but the branch metrics still call the same episodes valid. Branch validation is still measuring structural branch presence more than rendered-path causality.

### M2. Choice coverage diagnostics still miss beat-level choices

Each episode's narrative diagnostics warn that planned choice-point scenes authored no choices, even though choices are nested inside beats throughout the scenes. This is the same diagnostic-model mismatch seen in G22: the authored story uses beat-level choices, while this check appears to look in the wrong place.

### M3. Pronoun repair is overcorrecting or misclassifying fields

A validator replay found 33 `npc_pronoun_inconsistency` warnings over 1,790 scanned fields. Examples include malformed substitutions like:

- `Kylie Marinescu freezes mid-toast, him eyes fixed...`
- `Kylie Marinescu leans him forehead against him apartment door...`
- `Mika immediately starts teasing him about the garnish.`

Some Victor `her` warnings are false positives if `her` refers to Kylie, but the `him eyes` / `him forehead` cases are real repair damage. The pronoun resolver needs tighter subject/object ownership before rewriting.

### M4. Callback debt is still too high

The direct final-contract replay reports:

- 1 unset condition flag: `accepted_victor_invitation_ep2`
- 31 write-only flags out of 92 setters / 38 consumers
- 24 flags set but never referenced in text variants

Some future-window flags may be acceptable in a three-episode slice, but the callback validator is still right to block this as a silent-choice problem.

### M5. Skill balance is better than G22, but still too persuasion/perception-heavy

Direct scan of choice stat checks in the saved partial:

- Ep1: persuasion 36%, perception 30%, investigation 21%, survival 9%, deception 4%
- Ep2: persuasion 53%, perception 27%, investigation 18%, deception 2%
- Ep3: persuasion 49%, perception 36%, investigation 7%, deception 6%, survival 3%

This is improved from the old single-skill collapse, but ep2 and ep3 still make persuasion/perception the dominant meta and have no hard checks in the saved partial.

### M6. Media never ran to completion

`image-manifest.json` is `imagesStatus: pending`:

- total beats: 122
- beats with images: 0
- total scenes: 18
- scenes with images: 0
- scene background slots: 15

This is expected for a final-contract abort, but it means G24 cannot be evaluated as a visual reader package.

## Treatment / Story Quality Notes

There is playable-feeling prose in the middle of the partial, especially the apartment friendship setup, the rooftop banter, the Cismigiu attack/rescue, and the Casa Stelarum clue texture. But the story is not stable enough to judge as a candidate season slice because scaffolding text, skipped setup paths, and encounter POV corruption are still load-bearing.

Treatment fidelity is mixed:

- The broad episode premises are present: arrival/blog/friend-group, Mr. Midnight/Victor, the country weekend.
- The treatment's required authored turns are not reliably dramatized after repair. Earlier incremental reports still flag missing required beats in ep1 `s1-4`, ep2 `s2-2`, and ep3 `s3-4`.
- Ep3 especially drifts: a breakfast/blog-pressure scene is reduced to generic development-scene scaffolding in `s3-4`.

## Process / Validator Gaps

- **Final contract data is too hard to audit after failure.** The thrown error saved only `99-pipeline-errors.json` plus worker timeline data. Save the full final contract report as JSON even when it fails.
- **Partial story snapshot may be stale relative to repair.** The worker log says outcome-text repair ran, but `partial-story.json` still contains those stubs.
- **Branch metrics need path-continuity awareness.** The final contract catches setup-skipping routes; episode branch metrics should, too.
- **Choice coverage diagnostics need beat-level awareness.** Otherwise they keep warning that choice scenes have no choices.
- **Scene prose repair must reject planning-register output.** Phrases like `Open the episode...`, `Introduce Stela...`, and `Decide how to handle...` should be deterministic blockers before final repair spends LLM calls.
- **Encounter POV/prose repair still needs a hard backstop.** G24 still has `You kiss you`, `You freez`, and third-person protagonist outcome/storylet text.
- **Pronoun repair needs a regression guard.** The resolver should never create strings like `him eyes`, `him forehead`, or `him laptop`.

## Remediation Priority

1. **Save failed final-contract reports in full.** Add `09-final-story-contract.failed.json` or equivalent before throwing, including all blocking issues, warnings, metrics, and repair attempts.
2. **Make setup-skipping bridges impossible earlier.** Run the final-contract bridge skip check immediately after branch repair / bridge insertion, before scene prose and encounter generation spend.
3. **Block planning-register prose deterministically.** Scan beat text, variants, visual moments, and primary actions for scene-planning phrases before final repair.
4. **Persist repair mutations to `partial-story.json` on abort.** If the final repair changes the story and still fails, the partial snapshot should reflect the last repaired candidate.
5. **Fix encounter second-person repair at the structured encounter layer.** Do not only scan scene beats; scan encounter descriptions, phase beats, choices, outcomes, storylets, costs, and visual contracts.
6. **Tighten pronoun repair.** Add tests for `him eyes`, `him forehead`, `him laptop`, and subject/object misbinding in mixed protagonist/NPC sentences.
7. **Update branch metrics and choice diagnostics to match the runtime story shape.** Beat-level choices and path-causality failures need to be first-class in the same reports the generator UI reads.

## Verification Performed

Commands and checks run from `storyrpg-prototype/` or workspace root:

```bash
find generated-stories/bite-me-g24_2026-06-19T16-33-48 -type f
python3 scripts via repo root to inspect .generation-jobs.json, .worker-jobs.json, partial-story.json, incremental contracts, branch metrics, callback ledger, image manifest
TS_NODE_PROJECT=tsconfig.worker.json npx ts-node --transpile-only -e '...new FinalStoryContractValidator().validate({ story: data.story, requestedEpisodeNumbers:[1,2,3], treatmentSourced:true })...'
```

I did not run `npm run validate:assets` because G24 has no completed package or generated images to validate. I did not run reader playback because there is no `story.json`/`manifest.json` package to load.
