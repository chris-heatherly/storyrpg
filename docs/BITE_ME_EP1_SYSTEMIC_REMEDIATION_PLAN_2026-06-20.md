# Bite Me Episode 1 Systemic Remediation Plan

Date: 2026-06-20

## Current Status

Latest proof output:

- `storyrpg-prototype/generated-stories/bite-me_2026-06-20T16-25-01/`
- Worker job: `worker-1781972618118-16rgwcfm`
- Final status: completed
- Final contract: passed
- Final blockers: 0
- QA: passed, 82/100, no critical issues
- Incremental contract: passed, blockingCount 0

This is real progress from the overnight loop:

- ChoiceAuthor no longer hits repeated same-prompt `MAX_TOKENS` in the observed runs.
- Encounter storylet boilerplate/default prose is hard-rejected before acceptance.
- The `s1-3` required-beat realization loop now converges across repeated runs.
- The final malformed-prose blocker was fixed as a validator false positive.
- Tint flags no longer create false callback debt from malformed `tint_*` output.
- Episode-level contract artifacts now receive callback ledger context and no longer carry stale callback blockers.

## Remaining Warnings

The latest run still has warnings that should not be waved away for a "clean" Bite Me episode:

1. `qa_blocker_present`
   - Several stat checks still report difficulty `30`, below the supported 35-80 band.
   - A local assembly normalization was added and tested, but warnings persist, which means the warning source is using pre-normalized choice data or an earlier best-practices report.

2. `treatment_fidelity_violation`
   - The Episode 1 courtyard dog plant is missing on-page.
   - The treatment makes this a recurring Radu setup and later payoff, so this is a real treatment-fidelity gap even if currently warning-level.

3. `treatment_fidelity_violation`
   - `Victor's Nature` can also surface as an incremental warning in some runs.
   - This appears to be a seed/plant realization issue, not a final blocker.

4. `encounter_outcome_desync`
   - Incremental artifact can warn that the post-encounter reconvergence scene has no outcome-conditioned text.
   - Final story does contain deterministic encounter outcome variants, so this is likely an ordering/artifact consistency problem: the incremental pass runs before final deterministic outcome variant seeding or does not consume the same repaired episode surface.

5. Resume/output ownership
   - Resume jobs repeatedly show an old `outputDir` while `checkpoint.outputs.output_directory.outputDirectory` points to the real active output directory.
   - Resume also replays early phases instead of resuming from the nearest valid checkpoint. This wastes time and makes audit trails harder to trust.

## Why More Point Fixing Is the Wrong Move

The current failures are not one-off model mistakes:

- Validators and artifacts are reading different story surfaces at different points in the pipeline.
- Some deterministic repairs happen after advisory contracts, so artifacts can report problems that the final story no longer has.
- Some best-practices warnings are generated from pre-normalized data.
- Treatment seed placement is too loose: seeds can be bound to scenes that are awkward or impossible to realize naturally, then remain advisory until final contract warns.

Fixing one warning at a time risks creating more stale artifacts and more post-hoc repair behavior, which conflicts with the goal: each episode should be generated, validated, repaired, and enshrined cleanly before bundling.

## Proposed Remediation

### M1: Establish a Single Episode Seal Surface

Create an `EpisodeSeal` step that runs after all deterministic local repairs that affect the episode's shipped surface:

- callback injection
- encounter outcome flag seeding / text variant seeding
- stat-check normalization
- continuity repair
- branch repair
- cliffhanger repair
- final scene/choice assembly

The seal should produce:

- final episode object
- final scene contents / choice sets that match the episode object
- callback ledger snapshot
- branch metrics
- incremental contract
- QA/best-practices summary

Acceptance:

- `episode-<n>-incremental-contract.json` must not contain stale blockers from a pre-repair surface.
- Any warning that remains must correspond to the same episode object written to `checkpoints/episode-<n>-complete.json` and final `story.json`.

### M2: Move Mechanical Normalization Before QA and Best-Practices Validation

The current assembly seam normalizes stat checks, but QA/best-practices warnings still see pre-normalized values.

Move or share normalization so the following all read the same normalized choice data:

- assembled story
- QA report
- IntegratedBestPracticesValidator
- final contract
- incremental contract

Acceptance:

- No generated stat check has difficulty outside 35-80 unless a validator explicitly allows it.
- `skillWeights` sum to 1.0 before QA/best-practices run.
- No `qa_blocker_present` warnings for values already normalized in the shipped story.

### M3: Seed Placement and Realization Policy

Split treatment seeds into explicit classes:

- choice-dependent residue seeds
- physical/location plants
- information-ledger plants
- future-window-only obligations

Then route and validate them differently:

- Choice-dependent seeds should only attach to scenes/choices that set the corresponding flags.
- Physical plants like "the stray dog in the courtyard" should bind to a scene whose setting can carry them.
- Future-window-only obligations should be ledgered, not forced into awkward on-page prose.
- If a treatment plant is required for a later reveal, it should be either realized during scene generation or explicitly recorded as future-window debt with a due episode.

Acceptance:

- The courtyard dog appears naturally on-page in Episode 1, or is intentionally ledgered with a due payoff and not reported as dropped.
- Required seed warnings are not left for final packaging to discover.

### M4: Resume and Output Directory Consistency

Repair resume bookkeeping so job status and checkpoint state agree:

- `outputDir` / `outputDirectory` must point to the active resumed output directory.
- Resume should start from the latest valid checkpoint where possible.
- The monitor should expose the real phase and active artifact path without needing to inspect nested checkpoint fields.

Acceptance:

- A resumed job does not replay world/foundation when episode-complete checkpoints are valid and inputs are unchanged.
- A resumed job's public status reports the same output directory that artifacts are written to.

## Recommended Approval Scope

Approve M1-M3 as a single systemic pipeline pass. They are related and should be solved together so generation-time episode artifacts, final contract validation, and treatment fidelity all agree.

M4 can be approved separately if you want to keep resume/runtime orchestration isolated from generation quality.

## Non-Goals

- No Story-specific hardcoding for Bite Me.
- No reader/generator boundary changes.
- No major model-provider-specific behavior unless a provider truly requires it.
- No final-story surgery that mutates completed episodes without rerunning the episode seal.

## Verification Plan

1. Focused tests:
   - choice/stat normalization
   - callback ledger/incremental contract consistency
   - seed routing and future-window classification
   - encounter outcome variant visibility in episode-level contract

2. Worker typecheck:
   - `npm run typecheck:worker`

3. Generation proof:
   - Generate Bite Me Episode 1.
   - Require:
     - final contract passed
     - incremental contract passed with blockingCount 0
     - no `qa_blocker_present` warnings caused by normalized stat checks
     - no dropped load-bearing Episode 1 treatment plants
     - no boilerplate/default/template prose scan hits

