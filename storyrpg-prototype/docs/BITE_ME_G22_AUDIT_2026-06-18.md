# Bite Me G22 — Audit vs Storytelling / Gameplay / Branching Rules

**Run:** `generated-stories/bite-me-g22_2026-06-18T22-44-24`  
**Generated:** 2026-06-19T02:09:16.525Z  
**Pipeline summary:** QA 89, validation 69, `validationPassed: true`, `finalStoryContractPassed: true`, blocking issues 0.

## Verdict

**Not shippable.** G22 is a real scene-prose improvement over older Bite Me runs: the non-encounter scenes often have the right rom-com/horror pressure, the authored cliffhangers land, the fiction-first rule mostly holds, and the scene graph is reachable. But the run fails three load-bearing contracts:

1. **Encounter prose is badly corrupted** by a second-person rewrite bug (`you rooftop`, `you bar`, `you hedge`, `you kiss takes`, etc.). This affects all three encounters and their storylets, so the main gameplay set-pieces are player-facing broken text.
2. **Structural branches skip required setup scenes.** One choice in each episode can route around material the later plot assumes happened, violating branch-and-bottleneck continuity.
3. **Pipeline pass/fail is dishonest.** Saved metrics include 3 blocking callback errors, QA includes 5 continuity errors, and the final contract still reports pass.

## What Works

- **Episode cliffhangers now match the treatment well.**
  - Ep1 ends with Stela's dream/herbs text plus black roses/quartz.
  - Ep2 ends with the Casa Stelarum invitation and no-photo Ileana warning.
  - Ep3 ends with Radu's scarf on the doormat and the watching dog.
- **Scene-level tone is often right.** The dating-column banter, Mika/Stela warmth, Victor's private-man pressure, Radu's low-key contrast, and blog-as-voice engine are recognizably Bite Me.
- **Fiction-first presentation is largely clean.** The contract reports 0 mechanics leaks over 156 checked texts; my skim found metadata-like language mostly outside player prose.
- **Reachability is clean at scene level.** All 16 scenes are reachable from their episode starts.

## Blockers

### B1. Encounter prose corruption makes all set-pieces unplayable

The three encounters are structurally present, but the generated player-facing text is grammatically mangled throughout. Examples:

- Ep1 setup: `You're on you rooftop... You Dusk Club... across you bar... near you stair`.
- Ep1 choices/outcomes: `Hold you charcoal stranger's gaze`, `You attacker drops`, `you charcoal suit`, `you first idling cab`.
- Ep2 outcomes: `She slides you key card back across you velvet`, `By you time you back-room door clicks`.
- Ep3 setup/outcomes: `Victor stops where you hedge dead-ends and you music can't reach`, `You kiss takes`, `you candle between them dies`, `you maze' exit`.

This is worse than a craft issue: encounters are supposed to be the episode's mechanical/dramatic set-piece. In G22 they are the most visibly broken prose in the package.

### B2. Encounter POV remains broken

The final contract reports 3 `encounter_pov_break` warnings. The text confirms it:

- Ep1 victory: `You lift her hand... She does... catches herself smiling`.
- Ep2 partial/defeat storylets alternate between `you`, `she`, and possessive corruption.
- Ep3 victory/partial/defeat/escape all switch between second-person and third-person protagonist references.

This violates the second-person reader contract and makes outcome storylets feel detached from player agency.

### B3. Branches can skip required setup

The graph is reachable, but several choice bridges route around content the later story treats as mandatory:

- **Ep1:** `choice-decline-keycard` routes from `s1-1` directly to `treatment-enc-1-1`, skipping `s1-2` and `s1-3`, including Stela's meaningful introduction, the Dusk Club formation beat, and Victor's rooftop sightline. The encounter then assumes all of that context.
- **Ep2:** `choice-stela-herbs-deflect-laugh` routes from `s2-1` directly to `s2-4`, skipping `treatment-enc-2-1` and `s2-3`. `s2-4` then debriefs Radu/The Mountain as if the player experienced the cab breakdown.
- **Ep3:** `choice-skip-entirely` routes from `s3-1` directly to `s3-3`, skipping `s3-2`'s Casa Stelarum arrival, Victor courtship, dinner, and dark-wine choice. `s3-3` starts in the ballroom as if those happened.

This violates branch-and-bottleneck design. Branches may create different experiences, but they cannot bypass required causality and then reconverge into prose that assumes the skipped path.

### B4. Final contract pass masks actual blocking errors

The package says:

- `finalStoryContractPassed: true`
- `finalStoryContractBlockingIssues: 0`

But `07-validation-metrics.json` contains 3 blocking callback-opportunity errors:

- 16 flags set but never referenced in text variants.
- 11 flags set but never referenced.
- 18 flags set but never referenced.

`06-qa-report.json` also reports `passesQA: false` with 5 continuity errors. The final contract downgrades this to `qa_blocker_present` / continuity warnings. That means the final saved status cannot currently be trusted as a shipping signal.

## Major Findings

### M1. Continuity errors are real, not just validator noise

QA reports 5 continuity errors. The most player-facing ones are:

- Ep1 `s1-3` jumps from the Lumina/bookshop errand to "Night three" at Dusk Club. G22 tries to bridge this with one sentence, but the branch skip in B3 can still remove setup.
- Ep2 `s2-4` references Dragan Vintage and a Radu cab repair with zip-tie detail not reliably established for all paths.
- Ep3 `s3-3` introduces Ileana cold in the powder room, then treats her as emotionally important immediately.

### M2. Callback and flag economy is still weak

My direct scan found 119 set flags, 51 read flags, and about 70 set-but-never-read flags in the generated package. The final contract reports 46 player-choice flags set but never read in the generated range, and the validation metrics report unrepaired callback debt as blocking.

Some dead flags are acceptable future-window hooks in a 3-episode slice, but many are immediate residue that should matter in-range: Mika keycard, Stela/quartz state, encounter outcomes, wine, Ileana contact, blog choices, and scarf choices.

### M3. Choice/branch validators are measuring the wrong thing

Branch metrics call each episode valid, with divergence ratios at 1.0 and `cosmeticChoicePoints: 0`, yet the playable graph includes the setup-skipping bugs above. This is the same broad failure mode as earlier audits: state/route distinction is counted, while rendered experiential continuity is not.

The narrative diagnostics also report `choice_coverage` warnings saying planned scenes authored no choice even though choices are nested in beats. That suggests this diagnostic does not understand the current beat-level choice model.

### M4. Skill plan still collapses toward perception/persuasion

The final contract reports episode 3 at 44% perception despite the plan favoring investigation, survival, athletics, and stealth. It also flags ep1's encounter as invalid because perception carries 67% of 33 choice slots. Validation metrics show only 5/8 canonical skills and 0 hard checks. This keeps "always pick perception/persuasion" as the dominant meta.

### M5. Encounter depth is improved in metadata, not in player clarity

Telemetry says all 3 encounters ran the phased path successfully, but each has one phase. Storylets exist, but the outcomes all reconverge to the next normal scene and are marred by B1/B2. The result is more data than older runs, but not yet a satisfying multi-phase set-piece in the player's hands.

### M6. Treatment fidelity is mixed

The good: the main episode premises and cliffhangers are mostly preserved.

The bad:

- Ep1's authored cliffhanger is present, but black roses use Radu's scarf line (`Thought you'd be cold. — R.`) two episodes early, muddying the ep3 scarf cliffhanger.
- Ep2's required Radu/cab path can be skipped by the herb-deflection branch even though the episode's cliffhanger and later debrief assume Radu exists in the player's experience.
- Ep3's wine branch can be skipped by the blog choice route, yet later maze/breakfast content still assumes the estate courtship texture.

## Process / Validator Gaps

- **Final contract gating gap:** QA errors and validation blocking issues are not blocking final save.
- **Encounter prose repair gap:** The second-person rewrite corrupts grammar and no validator catches obvious `you <noun>` patterns.
- **Path-continuity gap:** Branch validators need to simulate rendered paths and assert each reconvergence only references events present on that path.
- **Beat-choice coverage gap:** Diagnostics need to count beat-level choices as authored choices.
- **Callback honesty gap:** Callback coverage can pass while the final package still has large unrepaired callback debt.
- **Encounter skill gap:** Skill-plan conformance needs to include encounter slots as blocking or auto-rebalanced before save.

## Remediation Priority

1. **Hard-block corrupted encounter prose** before final save. Add a deterministic scan for `you <noun>` / malformed possessives in encounter setup/outcome/storylet text, then repair or regenerate.
2. **Block path-skipping bridge routes** where a branch target skips scenes later assumed by reconvergence prose. Start with choice-bridge beats that jump more than one scene forward.
3. **Make final save respect QA/validation blockers.** If `passesQA:false` or `07-validation-metrics.blockingIssues.length > 0`, final contract should not pass unless the issue is explicitly classified as non-shipping.
4. **Simulate rendered paths, not just scene reachability.** Validate that every path into a bottleneck has seen the facts referenced by that bottleneck.
5. **Fix encounter POV at the same time as grammar.** Outcome/storylet prose must stay in second person unless intentionally quoting or referring to an NPC.
6. **Rebalance encounter skills post-generation.** Cap any single skill near 40% and honor episode skill targets.

