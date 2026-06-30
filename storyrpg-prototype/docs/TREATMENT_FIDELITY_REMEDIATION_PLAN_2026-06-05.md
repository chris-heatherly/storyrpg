# Remediation Plan — Make the StoryRPG Pipeline EXPAND an Authored Treatment, Not Re-Plan It

> Authored 2026-06-05. Audience: pipeline engineer. All `file:line` references verified
> against the working tree on `chris/story-playthrough-qa-system-sdeviants` and the run
> `generated-stories/endsong_2026-06-05T18-38-45`.
>
> **Provenance note.** This plan was produced by a multi-agent workflow (map → diagnose →
> adversarially verify → plan). The verification phase corrected the originating audit: the
> document physically ingested by the audited run was **not** the canonical
> `ENDSONG_StoryRPG_Treatment copy.md` — it was an earlier/alternate revision that already
> carried the re-cut episode titles and beat anchoring. Several "re-cut" symptoms are therefore
> a **treatment-version mismatch**, not a positional-merge defect. Read §0 before touching code.

---

## 0. What the verification changed (do not chase phantoms)

Two of seven proposed root causes were **refuted**; three more had their *mechanism* corrected
even though the symptom is real.

- **RC1 (CONFIRMED, dominant cause).** The document ingested by this run
  (`00-input-brief.json.rawDocument`, 103,241 chars) is **not** the authored treatment
  (`ENDSONG_StoryRPG_Treatment copy.md`, 157,415 chars). The rawDocument is a structurally
  complete but **differently-cut rewrite**: it already carries `### Episode 1: Dawn in Silvermist
  Valley` / `Episode 2: The Archive Beneath the Ruins` / `Episode 3: The Walls of Fort Dawnwatch`,
  already places plotTurn1 on its Ep2, and already spends the blood-key reveal in the Hook.
  `"Dawn and Discord"` = 0 occurrences in rawDocument, 2 in the authored .md. The pipeline
  **faithfully preserved a corrupt input.** Threading seam: `documentParser.ts:594`
  (`rawDocument: doc.rawContent`) — verbatim pass-through, no version/identity guard.
  **Correction:** the originally-cited `storyGenerationService.createPipelineAndPlan` does not
  exist. The rawDocument is *not* a stripped dump — it has full Structural-role and Encounter-anchor
  bullets — so a "completeness check" will NOT detect the swap; only a **title/cut/version
  comparison against the canonical treatment** will.

- **RC2 (REFUTED as an episode-recut cause).** `SourceMaterialAnalyzer.assembleAnalysis` already
  makes the treatment authoritative when extraction succeeds:
  `SourceMaterialAnalyzer.ts:1109-1111` sets `totalEpisodes = treatmentEpisodeNumbers.length`;
  `:1113-1145` iterates the authored slots; `:1179` pins `title = authoredTitle || ep.title`. The
  episode list was **not LLM-invented** in this run. Drifts #1/#3 are a **treatment-version
  mismatch**, not a positional-merge defect. **Do not** build a fix premised on "the LLM invented
  episodes." Legitimately weak residual: `validateExtractedTreatment` is warning-only
  (`treatmentExtraction.ts:516-541`) and never blocks.

- **RC3 (REFUTED).** The refresh DOES reach the SeasonPlan. `FullStoryPipeline.ts:10030` calls
  `refreshAnalysisFromTreatmentDocument` and `:10031` immediately calls
  `refreshBriefSeasonPlanFromAnalysis` (`~21568`), which rebuilds `baseBrief.seasonPlan.episodes`
  pinning `title:=guidance.authoredTitle` *before* episode authoring. `authoredTitle`/
  `rawStructuralRole` are produced by the **deterministic parser** (`treatmentExtraction.ts:273-330`),
  not the LLM. No ordering bug to fix. (Minor real gap: the *initial* SeasonPlanner LLM pass in
  `runStoryAnalysis` runs on un-refreshed analysis, but its output is deterministically overwritten.)

- **RC4 (REFUTED).** `distributeSevenPoints` does **not** shift beats one slot earlier. The real
  formula is `Math.round(anchor*(totalEpisodes-1))+1` (`sevenPointDistribution.ts:97`), which for
  N=10 yields plotTurn1=Ep3, pinch1=Ep4, midpoint=Ep6, pinch2=Ep7 — matching canon. The fallback
  never fired because per-episode `Structural role` bullets are parsed
  (`treatmentExtraction.ts:274-330`) and take priority. The beat shift was inherited from the
  re-cut input. **Real residual gap (keep):** Section 7's per-episode `(EpN)` anchoring in the
  canonical treatment is captured only as free text in `seasonGuidance.seasonSpine`
  (`treatmentExtraction.ts:495`) and is never reconciled against the per-episode Section 9
  `Structural role` bullets.

- **RC5 (CONFIRMED).** The schema has **no required-beat slot.** `PlannedScene`
  (`scenePlan.ts:103-199`) and `PlannedSceneEncounter` (`scenePlan.ts:74-96`) carry no
  `requiredBeats`/`signatureMoment` field. Authored turns ride as advisory prompt text
  (`authorScenePlan.ts:83-95`; the prompt literally says "Beats are NOT planned here").
  `composeDramaticPurpose` folds all turns into one `dramaticPurpose` string
  (`seasonScenePlanBuilder.ts:77-101`). `StoryArchitect.ts:3187-3192` emits turns as advisory
  bullets ("Do not create a new schema layer"). Consequence seeds are read/consumed but **never
  emitted**: all 19 `treatment_seed_*` flags in `story.json` sit in read/consume positions, 0
  emitters — confirmed continuity defect. The Ep2 battlement/naming beat is not just absent but
  **inverted** in the prose ("He didn't").

- **RC6 (CONFIRMED).** `runWorldBuilding` forwards **no seasonPlan**
  (`FullStoryPipeline.ts:6585-6602`); `runCharacterDesign` forwards only
  `seasonAnchors`+`seasonSevenPoint` (`:6673-6674`), never
  `characterArchitecture`/`informationLedger`/`locationIntroductions`. Both agents truncate
  rawDocument to **3000 chars** against a 103KB doc (`WorldBuilder.ts:475`,
  `CharacterDesigner.ts:479`). WorldBuilder hard-caps **"exactly 3 locations and 2 factions"**
  (`WorldBuilder.ts:539`), dropping 3+ of 6 authored locations. `CharacterProfile` is
  Want/Fear/Flaw (`CharacterDesigner.ts:96-99`) — no Need/Truth/Wound — collapsing the authored
  5-axis model. The structured `informationLedger`/`characterArchitecture`/`locationIntroductions`
  exist in `seasonPlan` but appear in **no other artifact**.

- **RC7 (REFUTED mechanism, CONFIRMED coverage gaps).** The `synthesizeTreatmentGuidance.ts:41`
  tautology is NOT the cause — that function is a no-op when guidance already exists
  (`:27 if (ep.treatmentGuidance) continue;`). The final-story gate is a **hard throw**
  (`enforceFinalTreatmentFidelity`, `FullStoryPipeline.ts:3210-3226`), not advisory; it passed
  because the generated titles matched the **re-cut input** it was validated against. **Real gaps
  that survive (build these):** (a) `SevenPointCoverageValidator` has no treatment input — blind
  to authored beat→episode mapping; (b) `FinalStoryContractValidator` `empty_scene` fires only when
  `!scene.encounter && beats.length===0` (`:205`), so 0-beat scenes carrying a trivial encounter
  pass; (c) `InformationLedgerValidator` validates only the generated ledger's internal runway
  (`:38-39`), never reconciling authored INFO entries; (d) QA failure is downgraded to a warning
  (`FinalStoryContractValidator.ts:586-596`), so `06 passesQA:false` yet `07b passed:true`.

**Net:** the single biggest fix is **input integrity (RC1)** — the pipeline must refuse to run on
a non-canonical treatment. The second tier is **carrying authored content all the way down without
a lossy re-derivation (RC5, RC6)**. The third tier is **guardrails that are version-independent
(RC7 coverage gaps, RC4 residual)**.

---

## 1. Goal & guiding principle — "Expand, do not rewrite"

> **Contract.** When a story is generated from an authored treatment, the treatment is the *spine
> of record*. The pipeline's job is to **expand** each authored episode into scenes and beats and
> to **dramatize** each authored turn, signature device, information beat, and consequence seed —
> inventing only connective tissue, prose, and tactical texture. The pipeline must never re-cut,
> re-title, re-order, split, merge, or re-anchor authored episodes; never relocate a 7-point beat
> off its authored episode; never drop a signature staged beat; and never reach an authored
> consequence precondition that nothing on-page can satisfy. Every authored unit (Sections 1–9)
> must land in a *first-class structured field* on a planning artifact, not a free-text prompt
> hint, and a blocking guardrail must prove the output still contains it. Where the treatment is
> silent, inference is allowed and expected; where the treatment speaks, it wins.

---

## 2. Treatment-schema → planning-artifact mapping

| Treatment section | Must populate | Currently | Wire-through seam (file:line) |
|---|---|---|---|
| **1. Premise** | Season plan (logline/theme), world bible premise | Consumed (lossy prose) | `planningHelpers.ts:184` premise string; OK, keep. |
| **2. Season Promise / Engine** | Season plan (`seasonPromise`, repeatable engine), drives episode rhythm | Partially — lives in `seasonGuidance` free text | Add structured field on `SeasonPlan`; populate in `SeasonPlannerAgent.ts:1464` (`buildSeasonPlan`). |
| **3. Character Architecture** (Lie/Need/Truth/Wound/Want, micro-lies) | **Character bible** (per-character 5-axis), season plan `characterArchitecture` | **Dropped at bible** — `characterArchitecture` siloed in `seasonPlan`; `CharacterProfile` is Want/Fear/Flaw only (`CharacterDesigner.ts:96-99`) | (a) Extend `CharacterProfile` with `need`/`truth`/`wound`/`microLies`; (b) forward `brief.seasonPlan?.characterArchitecture` + `locationIntroductions` into `runCharacterDesign` (`FullStoryPipeline.ts:6660-6674`); (c) pass full doc, not `substring(0,3000)` (`CharacterDesigner.ts:479`). |
| **4. World + Location Brief** (per-location purpose/mood/history/choice-pressure, magic-cost rules, locations 4–6) | **World bible** (all authored locations + factions + rules) | **Dropped** — `runWorldBuilding` forwards no seasonPlan (`FullStoryPipeline.ts:6585-6602`); `substring(0,3000)` (`WorldBuilder.ts:475`); cap "exactly 3 locations" (`WorldBuilder.ts:539`) | (a) Forward `brief.seasonPlan?.locationIntroductions` into the WB call; (b) replace the hard cap with "create one location per authored location brief"; (c) pass full doc. |
| **5. Stakes Architecture** | Season plan `stakesLayers`, episode blueprint stakes, scene `stakes` | Partially — `stakesLayers` parsed into `treatmentGuidance`, lands in scene `stakes` opportunistically | Confirm carry from `treatmentGuidance.stakesLayers` → `PlannedScene.stakes` in `seasonScenePlanBuilder.ts`. |
| **6. Information Ledger** (INFO-1..N: setup/hint/reveal/payoff episodes) | **Flags + ledger** (per-INFO setup/reveal scheduled to authored episodes), season-canon | **Siloed** — `seasonPlan.informationLedger` reaches no downstream artifact; `InformationLedgerValidator` (`:38-39`) only checks generated runway | (a) Forward `informationLedger` into `runCharacterDesign`/`runWorldBuilding` context and into `episodePlantContext.ts`; (b) emit a setup flag per INFO at its authored setup episode and require its reveal at the authored reveal episode (see §4). |
| **7. 7-Point Spine** (per-beat `(EpN)` anchoring) | Season plan `sevenPoint` + `structuralRoleByEpisode` | Beat→episode anchoring captured only as free text `seasonSpine` (`treatmentExtraction.ts:495`); never reconciled with Section 9 role bullets | Add a parser that decomposes `Plot turn 1 (Ep3)` etc. into a `beat→episodeNumber` map; reconcile against per-episode `structuralRole` in `SourceMaterialAnalyzer.ts:1171-1175`; assert equality (§4). |
| **8. Arc Plan** | Season plan `arcs`, episode `actLabel`/`arcLabel` | Consumed — `arcs` mapped, labels copied to scenes | Keep; verify `actLabel`/`arcLabel` flow from `treatmentGuidance` → `PlannedScene` (`scenePlan.ts:148-150`). |
| **9. Episode Outline** — count/order/title | Season plan `episodes[]` identity | **Authoritative when extraction succeeds** (`SourceMaterialAnalyzer.ts:1109-1145,1179`) — but only warning if mismatch | Add blocking authored-episode-conformance validator (§4.1). |
| **9. — episode turns** | **Scene + beat** as REQUIRED beats | **Advisory prompt text only** — folded into one `dramaticPurpose` (`seasonScenePlanBuilder.ts:77-101`); no schema slot (`scenePlan.ts:103`) | Add `requiredBeats: RequiredBeat[]` to `PlannedScene`; bind each authored turn to a scene (§5). |
| **9. — encounter anchor** | **Scene** (`kind:'encounter'`) with non-empty content | Generated as empty placeholders (0-beat scenes); passes `empty_scene` because it has a trivial encounter (`FinalStoryContractValidator.ts:205`) | Tighten `empty_scene` and add encounter-anchor-non-empty check (§4.2). |
| **9. — info movement** | Flags + ledger (per-episode INFO setup/reveal) | Thin — `informationMovement` in `treatmentGuidance` but not scheduled | Info-ledger-schedule conformance (§4.3). |
| **9. — consequence seeds** | **Flags** (emitter + consumer) | **Read but never set** — 19 `treatment_seed_*` flags, 0 emitters; `episodePlantContext.ts` only re-surfaces already-set flags | Deterministically emit a `setFlag` for each authored consequence seed at its origin scene (§5). |
| **9. — cliffhanger** | Episode blueprint ending | Partially — `cliffhanger` in guidance | Carry to episode-ending scene; covered by existing Cliffhanger validator. |

---

## 3. Ordered work plan (phased, dependency-aware)

### Phase 0 — Input integrity (RC1, the dominant cause). Do this first.

**Step 0.1 — Treatment version/identity guard.**
- **Files:** `src/ai-agents/utils/documentParser.ts` (around `:594`), new `src/ai-agents/utils/treatmentFingerprint.ts`.
- **Change:** When a document is classified as a treatment (`treatment.isTreatment`), compute a
  fingerprint (episode count + ordered list of normalized authored titles + the Section-7
  beat→episode anchor map). Persist it alongside `00-input-brief.json`. Add an optional
  `expectedTreatmentFingerprint` to the generation request; if provided and it does not match the
  ingested document, **throw** before planning. At minimum, log a loud diagnostic listing the
  ingested episode titles so a version swap (`Dawn in Silvermist Valley` vs `Dawn and Discord`) is
  visible in `99-pipeline-errors.json`.
- **Acceptance:** Re-running on canonical `ENDSONG_StoryRPG_Treatment copy.md` records titles
  `Dawn and Discord … Endsong (FINALE)`; running on the re-cut doc with the canonical fingerprint
  set aborts with a clear "treatment version mismatch" error.

**Step 0.2 — Promote `validateExtractedTreatment` from warning to a gate (configurable).**
- **File:** `src/ai-agents/utils/treatmentExtraction.ts:516-541`; call site in `SourceMaterialAnalyzer.assembleAnalysis`.
- **Change:** Add a `strict` flag. In strict mode, existing warnings (non-contiguous numbering;
  heading-count > parsed-count) become a thrown `ValidationError`. Default-off, opt-in per run,
  consistent with the existing validator-gating pattern.
- **Acceptance:** A treatment whose headings outnumber parsed episodes aborts in strict mode;
  default behavior unchanged.

### Phase 1 — Episode-boundary & beat-anchor preservation (RC4 residual + RC2/RC7 gaps)

**Step 1.1 — Parse Section 7 beat→episode anchors into a structured map.**
- **File:** `src/ai-agents/utils/treatmentExtraction.ts` (near `:495`).
- **Change:** Decompose `Plot turn 1 (Ep3)`, `Pinch 1 (Ep4)`, `Midpoint (Ep6)`, `Pinch 2 (Ep7)`,
  `Climax (Ep10)` into `seasonGuidance.beatEpisodeAnchors: Partial<Record<SevenPointBeat, number>>`.
- **Acceptance:** On canonical .md (anchors at lines 264–268), the map reads
  `{plotTurn1:3, pinch1:4, midpoint:6, pinch2:7, climax:10}`.

**Step 1.2 — Reconcile Section 7 anchors against Section 9 per-episode `structuralRole`.**
- **File:** `src/ai-agents/agents/SourceMaterialAnalyzer.ts:1171-1175` + `SeasonPlannerAgent.ts:1450-1453`.
- **Change:** After per-episode roles are assigned, cross-check that each Section-7 anchored beat
  lands on the episode whose `structuralRole` carries it. On conflict in strict mode, throw;
  otherwise prefer the Section-7 anchor and log.
- **Acceptance:** Canonical treatment yields `plotTurn1` on Ep3.

**Step 1.3 — Authored-episode-conformance validator (blocking).** See §4.1.

### Phase 2 — Authored content carried to bibles (RC6)

**Step 2.1 — Forward structured season-plan sections into the bible agents.**
- **File:** `FullStoryPipeline.ts:6585-6602` (`runWorldBuilding`), `:6660-6674` (`runCharacterDesign`).
- **Change:** Add `locationIntroductions` to the WorldBuilder input; add `characterArchitecture`
  + `informationLedger` to the CharacterDesigner input. Extend each agent's input interface.
- **Acceptance:** WorldBuilder receives all authored locations; `02-character-bible.json` carries
  authored 5-axis data, not just Want/Fear/Flaw.

**Step 2.2 — Replace the lossy rawDocument truncation.**
- **File:** `WorldBuilder.ts:475`, `CharacterDesigner.ts:479`.
- **Change:** Pass the full treatment (or the relevant Section 3 / Section 4 slice resolved by
  heading, not `substring(0,3000)`). If prompt size is a concern, slice by *section* not char count.
- **Acceptance:** Section 4 locations 4–6 and Section 3 supporting micro-lies are in the prompt.

**Step 2.3 — Lift the location/faction hard cap.**
- **File:** `WorldBuilder.ts:539`.
- **Change:** Replace "Create exactly 3 locations and 2 factions" with "Create one location per
  authored location brief (N), one faction per authored faction." Drive N from `locationIntroductions.length`.
- **Acceptance:** `01-world-bible.json` contains all 6 authored ENDSONG locations.

**Step 2.4 — Extend `CharacterProfile` to the authored 5-axis model.**
- **File:** `src/ai-agents/agents/CharacterDesigner.ts:96-99` (interface) + prompt + parser.
- **Change:** Add `need`, `truth`, `wound`, `microLies?: string[]` alongside `want`/`fear`/`flaw`.
- **Acceptance:** Aethavyr's bible carries the authored Lie/Need/Truth/Wound.

### Phase 3 — Required-beats schema and consequence-seed emitters (RC5)

**Step 3.1 — Add a required-beat carrier to the scene schema.**
- **File:** `src/types/scenePlan.ts` (`PlannedScene` at `:103`, `PlannedSceneEncounter` at `:74`).
- **Change:** Add `requiredBeats?: RequiredBeat[]` to `PlannedScene` and `signatureMoment?: string`.
  Define `RequiredBeat { id; sourceTurn: string; mustDepict: string; tier: 'signature' | 'authored' | 'connective' }`.
- **Acceptance:** A scene can hold the Ep1 joined-blood signature beat and the Ep2 naming/leap turn
  as discrete required beats.

**Step 3.2 — Bind authored turns to scenes (stop the single-string fold).**
- **File:** `src/ai-agents/pipeline/seasonScenePlanBuilder.ts:77-101,137`.
- **Change:** Instead of folding all turns into one `dramaticPurpose`, assign each authored turn to
  the scene whose `narrativeRole` matches and push it onto that scene's `requiredBeats`.
- **Acceptance:** Each authored ENDSONG turn appears as exactly one `requiredBeat`; the Ep2
  battlement/naming turn is present.

**Step 3.3 — Deterministically emit consequence-seed flags.**
- **File:** `src/ai-agents/pipeline/episodePlantContext.ts` + consequence-seed parse in
  `treatmentExtraction`/`StoryArchitect.ts:3250-3255`.
- **Change:** For each authored consequence seed (e.g. `treatment_seed_ep3_1` = "Darian's poison
  set"), deterministically emit a `setFlag` on the origin scene so the Ep4 trap precondition can
  be true. The seed must be SET on-page, not only read.
- **Acceptance:** `story.json` shows `treatment_seed_ep3_1` in a setFlag position. Grep:
  `setFlag … treatment_seed_*` count > 0.

### Phase 4 — Guardrails (RC7 coverage gaps, version-independent). See §4.

---

## 4. New fidelity guardrails

Mirror the existing validator pattern in `src/ai-agents/validators/` (each exports `validate(input)`,
registered in `validatorRegistry.ts` with a tier, gated via `architectGatePolicy.ts`). New validators
default-off behind a gate flag, then promoted to blocking after the ENDSONG re-run proves them green.

### 4.1 `AuthoredEpisodeConformanceValidator` (NEW, **blocking**)
- **File:** `src/ai-agents/validators/AuthoredEpisodeConformanceValidator.ts`.
- **Input:** parsed `ExtractedTreatment` + final `SeasonPlan`.
- **Asserts (all blocking):** (a) episode **count** equals authored; (b) **order** preserved;
  (c) each **title** matches authored (exact after normalization — not fuzzy 0.5, which is what let
  the re-cut validate against itself); (d) each `structuralRole` matches the Section-7 anchor
  (Step 1.1); (e) no authored episode split/merged (1:1 slot mapping).

### 4.2 `EncounterAnchorNonEmptyValidator` (NEW, **blocking**) + tighten existing check
- **File:** new `src/ai-agents/validators/EncounterAnchorContentValidator.ts`; edit `FinalStoryContractValidator.ts:205`.
- **Asserts:** every scene derived from an authored encounter anchor has ≥1 reader-facing beat AND
  its `centralConflict`/`requiredBeats` are depicted. Change `empty_scene` so a scene carrying an
  encounter but 0 beats still fails. Closes the wall-breach-is-empty → poisoning-never-administered hole.

### 4.3 `InformationLedgerScheduleValidator` (NEW, **blocking**) — distinct from existing
- **File:** `src/ai-agents/validators/InformationLedgerScheduleValidator.ts` (existing
  `InformationLedgerValidator.ts:38-39` only checks the generated ledger's internal runway).
- **Asserts:** each authored INFO entry has its setup landing in (or before) its authored setup
  episode and its reveal in its authored reveal episode; reveal never precedes setup.
- **Severity:** blocking for reveal-before-setup; warning for off-by-one placement.

### 4.4 `SignatureDevicePresenceValidator` (NEW, **blocking**)
- **File:** `src/ai-agents/validators/SignatureDevicePresenceValidator.ts`.
- **Input:** `PlannedScene.signatureMoment` / `requiredBeats[tier==='signature']` + generated prose.
- **Asserts:** each signature staged beat appears in final prose (keyword + semantic). For ENDSONG:
  Ep1 joined-blood archive floor present; Ep2 naming + instinctive rescue leap present (and NOT
  inverted to "he didn't").

### 4.5 `SevenPointAnchorConformanceValidator` (NEW, **blocking**)
- **File:** `src/ai-agents/validators/SevenPointAnchorConformanceValidator.ts` (existing
  `SevenPointCoverageValidator.ts:91-104` has no treatment input — structurally blind).
- **Asserts:** each authored beat→episode anchor is honored in the final story.

### 4.6 QA downgrade hardening
- **File:** `FinalStoryContractValidator.ts:586-596`.
- **Change:** When a treatment is the source, do NOT silently downgrade QA failures to warnings for
  the fidelity classes above. Keep QA-prose downgrades; fidelity failures from 4.1–4.5 must hard-fail.

---

## 5. "Expand not rewrite" enforcement

The mechanism: **authored turns/anchors/devices become structured `requiredBeats` (Phase 3), and the
scene-authoring prompt changes from "design an episode" to "dramatize THIS authored episode beat-by-beat."**

1. **Carry, don't summarize.** Stop the single-string fold at `seasonScenePlanBuilder.ts:77-101`
   (Step 3.2). Each authored turn becomes a discrete `requiredBeat` with `mustDepict` text. The
   signature device becomes a `signatureMoment`.

2. **Rewrite the scene-author prompt.** `authorScenePlan.ts:76-119` currently calls the model "the
   season's scene planner. Plan the SCENES" and says "Beats are NOT planned here." For
   treatment-sourced runs, change the framing to: *"You are dramatizing an already-authored episode.
   The episode's turns, signature moments, and encounter anchors are FIXED and listed below as
   required beats. Produce scenes that depict every required beat in order. Invent only connective
   tissue, transitions, sensory texture, and prose. Do NOT add, drop, re-order, or re-interpret a
   required beat."* Render `requiredBeats` as an explicit numbered checklist, not a soft "Authored
   turns:" bullet block (`:83-95`).

3. **StoryArchitect stops saying "do not create a new schema layer."**
   `StoryArchitect.ts:3187-3192,3250-3255` instructs the LLM to express turns/seeds "through
   existing blueprint fields." Once the schema has `requiredBeats` and flag emitters (Phase 3),
   change this to *write turns into the required-beat field and consequence seeds into a setFlag emitter.*

4. **Beat-author stage receives required beats as constraints.** The downstream beat generation
   (which serves `dramaticPurpose`) must read `scene.requiredBeats` and guarantee each `mustDepict`
   is realized; the `SignatureDevicePresenceValidator` (§4.4) is the backstop.

---

## 6. Risks & non-goals

- **Legitimate inference must survive.** Treatments are not screenplays. Connective scenes,
  transitions, sensory detail, NPC micro-beats, tactical encounter texture, and prose voice are
  *expected* inventions. Only authored *turns, anchors, signature devices, INFO schedule, and
  episode identity* are fixed. The `requiredBeat.tier='connective'` band exists precisely so the
  model still has room to author.
- **Treatment gaps.** Where the treatment is silent, agents must still infer. Validators in §4
  assert presence of authored units, never absence of invented ones.
- **Over-constraining risk.** Binding every turn to exactly one scene can starve pacing if an
  episode has more authored turns than budgeted scenes. Mitigation: allow multiple required beats
  per scene; budget scene count from `max(estimatedSceneCount, authoredTurnCount)`.
- **Version-guard false positives.** The Phase 0 fingerprint must normalize whitespace/markdown so
  a trivially re-saved-but-identical treatment is not rejected. Default the strict version match
  OFF; opt-in per run.
- **Non-goal:** do NOT rewrite `synthesizeTreatmentGuidance.ts:41` — verification proved it a no-op
  when guidance exists; that change would be inert.
- **Non-goal:** do NOT add an ordering fix around `FullStoryPipeline.ts:10030-10031` — the refresh
  already reaches the SeasonPlan.

---

## 7. Validation — proving the fix on the ENDSONG treatment

**Precondition:** re-run against the **canonical** `ENDSONG_StoryRPG_Treatment copy.md` (157,415
chars), not the re-cut rawDocument. First confirm ingestion: `00-input-brief.json.rawDocument`
length ≈ 157K and contains `### Episode 1: Dawn and Discord` (0 occurrences of `Dawn in Silvermist
Valley`). If this fails, Phase 0 is not done.

Then assert on the new run's artifacts:

1. **Episode identity (RC1/Phase 1, §4.1).** `seasonPlan.episodes` has **10** episodes with
   authored titles in order: `Dawn and Discord`, `The Key and the Cage`, `The Siege Tightens`, …
   `Endsong (FINALE)`. No `Silvermist Valley`/`Archive Beneath`/`Fort Dawnwatch` titles. No Ep1 split.
2. **Beat anchoring (Phase 1, §4.5).** `structuralRole` places **plotTurn1 at Ep3** (siege),
   pinch1 at Ep4 (ravine), midpoint at Ep6, pinch2 at Ep7, climax at Ep10 — matching Section 7
   lines 264–268.
3. **Signature device (RC5, §4.4).** Ep1 prose contains the **joined-blood archive floor**, revealed
   via the device, NOT announced by Vraxxan. Vraxxan remains unseen until the Ep3 siege.
4. **Naming/leap beat (RC5, §4.4).** Ep2 prose contains Darian's battlement assault, Aethavyr's
   **instinctive rescue leap**, and Lysandra naming him **"Aethavyr"** — present and not inverted.
5. **No empty encounter scenes (RC7, §4.2).** `treatment-enc-1-1/2-1/3-1` each have ≥1 reader-facing
   beat. The Ep3 wall-breach scene depicts the Darian poisoning on-page.
6. **Consequence wiring (RC5, §3.3).** `story.json` shows `treatment_seed_ep3_1` in a **setFlag
   emitter** position; the Ep4 trap precondition is reachable.
7. **Info ledger (RC6, §4.3).** INFO-1..4 each have a scheduled setup and reveal on their authored
   episodes (INFO-4 "Sylvanor is Starborn" hint lands in Ep2).
8. **Bibles (RC6, Phase 2).** `01-world-bible.json` has all **6** authored locations;
   `02-character-bible.json` carries the **Lie/Need/Truth/Wound** 5-axis model for Aethavyr.
9. **Gates green.** `07b-final-story-contract` passes with the new blocking validators (4.1–4.5)
   enabled; QA fidelity failures are no longer downgraded (§4.6).

---

## Key seams (all verified)

- Input pass-through: `src/ai-agents/utils/documentParser.ts:594`
- Treatment extraction / validation: `src/ai-agents/utils/treatmentExtraction.ts:495` (seasonSpine free text), `:516-541` (warning-only validate)
- Episode authority (already correct): `src/ai-agents/agents/SourceMaterialAnalyzer.ts:1109-1145,1171-1179`
- Refresh (already correct): `src/ai-agents/pipeline/FullStoryPipeline.ts:10030-10031`
- Seven-point distribution (correct formula): `src/ai-agents/utils/sevenPointDistribution.ts:97`
- Scene schema (no required-beat slot): `src/types/scenePlan.ts:74-96,103-199`
- Single-string turn fold: `src/ai-agents/pipeline/seasonScenePlanBuilder.ts:77-101,137`
- Advisory scene-author prompt: `src/ai-agents/pipeline/authorScenePlan.ts:76-119` (esp. `:83-95`)
- Advisory architect bullets: `src/ai-agents/agents/StoryArchitect.ts:3187-3192,3250-3255`
- Bible forwarding gaps: `src/ai-agents/pipeline/FullStoryPipeline.ts:6585-6602` (WB), `:6660-6674` (CD)
- Lossy bible briefs: `src/ai-agents/pipeline/planningHelpers.ts:184-192,210-224`
- Truncation + cap: `src/ai-agents/agents/WorldBuilder.ts:475,539`; `src/ai-agents/agents/CharacterDesigner.ts:96-99,479`
- Empty-scene gap: `src/ai-agents/validators/FinalStoryContractValidator.ts:205`; QA downgrade `:586-596`
- Treatment-blind validators: `src/ai-agents/validators/SevenPointCoverageValidator.ts:91-104`; `src/ai-agents/validators/InformationLedgerValidator.ts:38-39`
- Synthesize no-op (do NOT touch): `src/ai-agents/pipeline/synthesizeTreatmentGuidance.ts:27,41`
