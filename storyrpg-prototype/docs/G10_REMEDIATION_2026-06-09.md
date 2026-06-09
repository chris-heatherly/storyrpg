# G10 Remediation Roadmap (2026-06-09)

Source: deep audit of `bite-me-g10_2026-06-09T04-07-00` and `endsong-g10_2026-06-09T04-08-57`.
Both seasons passed their gates (Bite Me validation 76 / QA 90; Endsong 80 / QA 90,
both `validationPassed: true`, `finalStoryContractPassed: true`) yet shipped **9
BLOCKER-class defects the gates missed**. This roadmap fixes the generators that
produce the defects and the gates that let them through.

## Meta-finding

The gates verify that a **flag/promise/state exists**, not that the **referenced
event was dramatized on-page**. That single blind spot accounts for the fabricated
"cargo" callback, the un-shown splinter clues, and the summarized signature
set-pieces. Phase 2 closes it.

## Rollout discipline (per `validator-gating-plan` / `gate-promotion` practice)

For every gate: **land the generator fix first → build/enable the detecting gate
default-OFF → one live `=1` run of BOTH stories → confirm zero false-positive
hard-fails → flip default-ON in `gateDefaults.ts` → record in quality ledger.**
Never ship a gate default-on before its generator fix lands. Keep the three
skill-doc sets (`.claude` / `.cursor` / `codex-skills`) in sync if rule text changes.

---

## Phase 0 — Generation correctness bugs (P0)

### 0.1 Empty/stub encounter scene  (Endsong ep2 `treatment-enc-2-1`)
- **Symptom:** encounter shipped `intent: null`, one residue beat
  *"You carry the weight of the choices that brought you here."*, single
  `"Continue..."` choice with null stakes/statCheck/outcomes.
- **Root cause:**
  - `src/ai-agents/pipeline/FullStoryPipeline.ts:2140-2189` `repairBranchReconvergence()`
    injects the residue beat (line ~2154) when `sceneContent.beats.length === 0` —
    applied to encounter scenes whose `beats[]` is *legitimately* empty (content in
    `scene.encounter.phases[].beats[]`).
  - `src/ai-agents/pipeline/EpisodePipeline.ts:790-805,855-872` emits the
    `"Continue..."` placeholder choice on the timeout/throw path.
- **Fix:** exclude encounter scenes from residue injection; add a hard guard that an
  encounter with content in *neither* `scene.beats` nor `scene.encounter.*` triggers
  regeneration (throw-safe `authorChoices` path) instead of a stub; emit a diagnostic
  to `99-pipeline-errors.json` when `EncounterArchitect.buildDeterministicFallback()`
  (`EncounterArchitect.ts:1920-2122`) is used for a treatment-sourced encounter.

### 0.2 `npcId: "None"` relationship deltas  (Endsong ep2)
- **Symptom:** 4/6 stat-gated choices wrote `adjustRelationship {npcId:"None", ...}`;
  engine silently drops them (`src/stores/gameStore.ts:735` `if (rel) {...}` no-op).
- **Root cause:** `src/ai-agents/converters/stateChangeConverter.ts:67-84` splits
  `sc.name` ("npcId:dimension") and assigns `npcId` with no roster validation; a
  serialized `None`/missing name becomes the literal string `"None"`.
- **Fix:** pass the character roster into the converter; drop or repair any
  `adjustRelationship` whose resolved `npcId` is empty / `"None"` / not in roster.

### 0.3 Template-stub `outcomeTexts`  (both stories, ~4 choices)
- **Symptom:** success/partial/failure restate `want`/`cost` verbatim with
  scaffolding ("It works — you get what you reached for: …"); lowercased proper nouns;
  one grammatically broken failure line.
- **Root cause:** `src/ai-agents/agents/ChoiceAuthor.ts:546-565`
  `buildFallbackOutcomeText` (templates at 557/560/563), applied in
  `normalizeChoiceSet` (689-704) when the LLM omits/dupes outcomeTexts.
- **Fix:** targeted single-tier re-prompt before falling back; rewrite fallback to not
  paste `want`/`cost` or use scaffolding phrasing; capitalize sentence-initial
  interpolations. Detect residual stubs via 2.2.

### 0.4 POV third-person leak in encounter outcomes  (Bite Me ep1/ep2)
- **Symptom:** encounter `nextSituation`/outcome fields authored 3rd-person
  ("Kylie smiles back…") in a 2nd-person story.
- **Root cause:** `PovClarityValidator` reads `beat.text`/`textVariants` but not the
  encounter `phases[]`/`storylets[]`/witness outcome fields.
- **Fix:** widen its text collection to the fields enumerated by
  `EncounterAnchorContentValidator.collectReaderFacingTexts()`.

---

## Phase 1 — Promote / tune existing gates (P1)

Infrastructure: `src/ai-agents/remediation/gateDefaults.ts` (`isGateEnabled()`,
lines 211-216), `src/ai-agents/validators/validatorRegistry.ts` (58-197),
`src/ai-agents/validators/issueEscalation.ts` (40-59).

### 1.1 Fix SignatureDevicePresence demotion  (catches both dropped-signature BLOCKERs)
- Validator is already `blocking` + default-ON (`GATE_SIGNATURE_DEVICE_PRESENCE`) but
  **demotes signatures >~15 tokens to advisory** (`SignatureDevicePresenceValidator.ts`
  ~line 400), treating verbose-but-staged moments as design-notes.
- **Fix:** demote only on meta-narration markers (refs to "the player", "treatment",
  "beat", "establish that…"), not on length. Missing staged signature → hard-fail when
  `treatmentSourced` (the §4.6 path already exists).

### 1.2 NPC pronoun-consistency gate  (Thorne they/them, Galen "their")
- `src/ai-agents/validators/protagonistPronounResolver.ts` handles the *protagonist*
  (gate `GATE_PROTAGONIST_PRONOUN`, default-OFF, `gateDefaults.ts:123`); the Thorne flip
  is an **NPC**, uncovered.
- **Fix:** add NPC established-gender pronoun scan over played prose using roster
  pronouns; deterministic repair + residue flag. Land determinism, then flip on.

### 1.3 Validate consequence npcIds  (backstops 0.2)
- `MechanicalStorytellingValidator` validates `witnessReactions[].npcId`
  (lines 107-135, `invalidWitnessReferences`) but not consequence npcIds.
- **Fix:** mirror the loop over `choice.consequences` type=`relationship`; add
  `invalidRelationshipReferences`; escalate via `issueEscalation.ts` +
  `GATE_RELATIONSHIP_ID_INTEGRITY`.

### 1.4 Promote QA continuity errors to blocking
- Both QA reports were `passesQA: false` (real continuity errors: kiss-erasure,
  poison-inversion, Thorne-wound setup) but surfaced as **warnings**
  (`qa_blocker_present`).
- **Fix:** flip `GATE_QA_CRITICAL_BLOCK` / `GATE_CONTINUITY_REMEDIATION` so a QA
  continuity error blocks + routes to scene regen. Survey error-tier precision first.

---

## Phase 2 — New validators (P2; close the on-page blind spot)

New files in `src/ai-agents/validators/`, registered in `validatorRegistry.ts`, gated
in `gateDefaults.ts`, wired into `FinalStoryContractValidator` / `runFidelityValidators`,
with unit tests. **Do not grow `FullStoryPipeline.ts`** (monolith ratchet).

### 2.1 `ReferencedEventPresenceValidator`  (fabricated "cargo" callback + un-shown clues)
When prose / a callback references a prior concrete event, verify it was dramatized in
earlier played prose (fuzzy substring / keyword-overlap over cumulative prior prose),
not only declared in a flag / seed / `sequenceIntent`. Advisory first, then promote.

### 2.2 `OutcomeTextQualityValidator`  (stub/leak detector; backstops 0.3)
Flag `outcomeTexts.{tier}` that is a substring of `want`/`cost`, matches scaffolding
patterns, is near-identical across tiers, or has lowercased sentence-initial proper
nouns. Cheap + high-precision → can go blocking quickly.

### 2.3 `EncounterSetPieceDepthValidator`  (summarized siege / 0-beat rooftop)
For treatment-staged "sustained" set-pieces, assert structure wasn't collapsed to a
single phase/decision (tensionCurve length, phase/beat/escalation count). Complements
1.1 (string present) by checking structural depth.

---

## Phase 3 — Balance enforcement (P3)

Plans exist (`src/ai-agents/pipeline/seasonChoicePlan.ts`,
`src/ai-agents/pipeline/seasonSkillPlan.ts`,
`src/ai-agents/pipeline/choiceTypePlanner.ts`) but are advisory.

1. **Binding choice types:** assert every choice point has a non-null planned `type`
   before `ChoiceAuthor` runs (`FullStoryPipeline.ts:~7340-7362`); `ChoiceAuthor`
   authors *to* the assigned type, not aspirational percentages.
2. **Mandatory skill plan:** always build `seasonSkillPlan` so
   `ChoiceAuthor.rebalanceStatCheckSkills()` (1123-1161) always runs; reweight extreme
   single-skill dominance even in blended checks.
3. **Gates:** flip `GATE_CHOICE_DISTRIBUTION` on; add `GATE_SKILL_COVERAGE`
   (`SkillCoverageValidator` ≥6/8 skills, <30% dominance, lines 78/86) — after 1–2 land.

---

## Sequencing

| Phase | Items | Risk | Gate posture |
|---|---|---|---|
| 0 | 0.1–0.4 generator fixes | Low | pure fixes |
| 1 | 1.1–1.4 gate promotions | Med | build OFF → `=1` run → flip ON |
| 2 | 2.1–2.3 new validators | Med | advisory → promote per precision |
| 3 | choice-type + skill enforcement | Med | OFF → validate → ON |

## Implementation status (2026-06-09)

All phases landed on `chris/story-playthrough-qa-system-sdeviants`; typecheck clean (4
tsconfigs), full validators+utils suite green (716+ tests). New gates default-OFF pending
one live `=1` run of both stories before flipping ON.

- **P0.1** ✅ `repairSceneGraphBranchResidue` skips encounter scenes → un-masks the
  existing `empty_scene` blocking check (`FullStoryPipeline.ts:2137+`).
- **P0.2** ✅ `canonicalizeStoryRelationshipConsequences` drops/remaps `None`/unknown
  relationship npcIds at final assembly (`witnessNpcResolver.ts`, wired in
  `FinalStoryContractValidator`).
- **P0.3** ✅ `ChoiceAuthor.buildFallbackOutcomeText` rewritten — no scaffolding/echo,
  capitalization-safe, tier+choice-distinct. (Targeted re-prompt-before-fallback
  deferred; the clean fallback + P2.2 detector cover the leak.)
- **P0.4** ✅ `PovClarityValidator.findThirdPersonProtagonistTexts` + encounter-prose
  scan in `FinalStoryContractValidator` (`encounter_pov_break`, advisory).
- **P1.1** ✅ Signature demotion now meta-narration-based, not length/dash-based;
  strict-presence behind `GATE_SIGNATURE_PRESENCE_STRICT` (default-OFF).
- **P1.2** ✅ New `npcPronounResolver.findNpcPronounInconsistencies` (Thorne they/them);
  `GATE_NPC_PRONOUN` (default-OFF). Detection-only (NPC auto-rewrite intentionally not done).
- **P1.3** ✅ `MechanicalStorytellingValidator` validates relationship-consequence npcIds
  (`invalidRelationshipReferences`); escalation `GATE_RELATIONSHIP_ID_INTEGRITY` (default-OFF).
- **P1.4** ✅ No new code — promotion mechanism pre-exists and `REMEDIABLE` types cover
  both G10 QA errors; `GATE_QA_CRITICAL_BLOCK`/`GATE_CONTINUITY_REMEDIATION` default-OFF
  pending live run (cannot be exercised offline).
- **P2.1** ✅ New `ReferencedEventPresenceValidator` — enumerated-objective promise check;
  verified against real G10 data (catches s3-3 photograph/maiden-name/Mika's-absence,
  **zero false positives** across both seasons). `GATE_REFERENCED_EVENT_PRESENCE`
  (default-OFF). Arbitrary dialogue back-references (the "cargo" case) are explicitly out
  of scope — an LLM-judge follow-up, not a keyword heuristic.
- **P2.2** ✅ New `OutcomeTextQualityValidator`; `GATE_OUTCOME_TEXT_QUALITY` (default-OFF).
- **P2.3** ✅ New `EncounterSetPieceDepthValidator`; `GATE_ENCOUNTER_SETPIECE_DEPTH`
  (default-OFF).
- **P3 → superseded by the plan-conformance redesign (below).** The original P3 measured
  a generated K-of-N slice against the whole-season target (choice-type % and skill
  coverage) — a category error: a partial generation is *not* supposed to be balanced, the
  season is. The `GATE_SKILL_COVERAGE` slice gate added in P3 was **backed out**. Replaced
  by the two-layer model.

## Plan-conformance redesign (2026-06-09, supersedes P3 balance)

**Principle:** balance is a whole-season property → validate it once over the *entire*
plan (L1). For a generated episode, only check it realized what the plan assigned to *it*
(L2 conformance). Never compare a K-of-N slice to the global target (delete L0).

- **L1 choice-type balance** — already correct: `seasonChoicePlan.ts:120` runs
  `ChoiceDistributionValidator` over all `plan.moments` vs target (`GATE_CHOICE_DISTRIBUTION`).
- **L1 skill coverage** — added `validateSeasonSkillPlan` (`seasonSkillPlan.ts`): asserts the
  rotation covers all 8 canon skills + leads rotate; wired as a runtime guard at
  `FullStoryPipeline` skill-plan build (logs, never throws).
- **L0 removed** — `IntegratedBestPracticesValidator` choice-type metric now emits
  `scope:'generated-slice'` with no `targetPercentages`/`deviations` (the misleading
  "strategic −20pp" signal is gone); `SkillCoverageValidator.blocking` + `GATE_SKILL_COVERAGE`
  reverted.
- **L2 `ChoiceTypePlanConformanceValidator`** (new) — per generated episode: Check B (budget
  fidelity) every type the season plan budgeted for E (`episodeTypeCounts`) appears in E's
  generated choices (presence, not counts); Check A (binding fidelity, when planned per-scene
  types supplied) generated type == planned. `GATE_CHOICE_TYPE_CONFORMANCE` (default-OFF).
  **Real-data: both G10 seasons CLEAN** — every generated episode realized its budgeted
  types (Endsong ep3 correctly budgets no strategic; eps1-2 realize theirs). Confirms there
  was no real choice-type defect — only the L0 artifact.
- **L2 `SkillPlanConformanceValidator`** (new) — per generated episode: if one skill carries
  >40% of stat-check weight AND it's off the episode's planned favoured lead, flag.
  `GATE_SKILL_PLAN_CONFORMANCE` (default-OFF). **Real-data: flags genuine off-plan perception
  dominance** — Endsong ep2 (43%), Bite Me ep2 (45%) / ep3 (46%) — while NOT flagging
  Endsong ep1 (intimidation on-plan) or ep3 (perception <40%). Points at
  `rebalanceStatCheckSkills` not steering perception off when the plan says it should — the
  real, actionable signal (vs. the meaningless "perception 45% vs 30% target" slice metric).

New gates (default-OFF): `GATE_CHOICE_TYPE_CONFORMANCE`, `GATE_SKILL_PLAN_CONFORMANCE`.
Removed: `GATE_SKILL_COVERAGE`.

### New gate flags (all default-OFF; flip after one live `=1` run on both stories)

`GATE_SIGNATURE_PRESENCE_STRICT`, `GATE_NPC_PRONOUN`, `GATE_RELATIONSHIP_ID_INTEGRITY`,
`GATE_OUTCOME_TEXT_QUALITY`, `GATE_ENCOUNTER_SETPIECE_DEPTH`,
`GATE_REFERENCED_EVENT_PRESENCE`, `GATE_SKILL_COVERAGE`. (Existing, also default-OFF:
`GATE_QA_CRITICAL_BLOCK`, `GATE_CONTINUITY_REMEDIATION`, `GATE_PROTAGONIST_PRONOUN`.)

## Definition of done

A fresh **G11** run of both stories with all gates on produces zero of the 9 audited
BLOCKER classes, `passesQA: true`, no template-stub outcomes, no `None` relationship
targets, dramatized (not summarized) signature set-pieces — verified by re-running this
audit.

## The 9 audited BLOCKER classes (for re-verification)

1. Encounter signature set-piece summarized/dropped (Bite Me ep1 rooftop/Cișmigiu; Endsong ep3 siege)
2. Empty/stub encounter scene (Endsong ep2)
3. Fabricated cross-scene callback / impossible knowledge (Endsong ep2 "cargo while asleep")
4. Un-shown clue seeds paid off later (Bite Me ep3 photograph / maiden name / Mika's missing hour)
5. Climactic kiss erased next morning (Bite Me ep3 timeline/affect)
6. Poison causality inversion (Endsong ep3 — effect 2 scenes before cause)
7. Established-gender pronoun flip in played prose (Endsong ep3 Thorne they/them)
8. POV third-person protagonist in encounter outcomes (Bite Me ep1/ep2)
9. `None`-targeted relationship deltas (Endsong ep2)

Secondary (major): template-stub outcomeTexts; false/hollow encounter options;
strategic=0% & perception-45% balance; Lysandra horse/carriage contradiction;
Radu scarf address gap.
