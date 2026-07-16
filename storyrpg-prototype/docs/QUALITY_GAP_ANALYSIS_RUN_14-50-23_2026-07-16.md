# Quality gap analysis — bite-me_2026-07-16T14-50-23 (independent verification + systemic plan)

First fresh run with ALL of Waves A+B live. Packaged, zero blockers, raw
91.09 → published 74 (two caps). I verified Codex's claims against the
artifacts; broad agreement on the gaps, with sharper mechanics on causes —
including one where our own advisory machinery caused a scoring artifact.

## What the new machinery did (verified)

- 37 anchor contracts compiled, correctly bound ("Radu's first sighting →
  s1-5, firstSighting: true"; "Stela's protection → s1-3").
- The departure judge flagged EXACTLY the two seams the reader feels:
  s1-5→Cismigiu and Cismigiu→s1-6 missing motivated exits (advisory, as
  designed).
- Flag audit: 6 never-consumed + 3 asymmetric families — the mechanical
  signature of "choices change state, not story."
- Every prior structural fix held: payoff beats intact, no restage, no
  identity-secret leaks, no duplicate ids, receipts honored.

**The headline: detection works. The gaps persist because detection is
advisory-only and nothing feeds it back into AUTHORING.** The systemic move
is closing that loop, not adding more detectors.

## Verified findings (beyond Codex)

1. **The user's teleport, pinned**: s1-4's bridge beat
   (`s1-4-b4-bridge-s1-4-b4-c2-cautious`) reads "you decide to walk home and
   process the night" then routes `nextSceneId: s1-5` — the ROOFTOP. The
   departure machinery fired but named the WRONG destination: the directive
   demands "a departure toward the next location" but does not forbid the
   LLM's default instinct ("walk home") when it contradicts the route.
2. **Score cap artifact — caused by us**: the `missing_required_treatment_atom`
   cap (score ceiling 74) regex-matches over ALL final-contract issues, and
   our ADVISORY departure warnings ("…departure is missing:
   transition:ep1:s1-5:to:treatment-enc-1-1…") match `missing.*treatment`.
   Advisory findings must never drive blocking-tier caps. True ceiling this
   run: responsiveness 62 → cap 79.
3. **Radu-in-s1-2 recurred despite the cast-order preflight** — findings
   were empty because his early placement rides ownership METADATA, not
   npcsPresent/npcsInvolved. The preflight has a surface blind spot.
4. **Cliffhanger overshot WITH the G6 escalation budget live** (window photo
   + "Now the real story begins" displaces Kylie's authored victory) —
   prompt-side budget alone is insufficient; it needs a judge-verified
   constraint atom on the final scene.

## Systemic plan

### A — Close the advisory→authoring loop (highest leverage)
- **A1. Post-choice reactivity at write time**: feed the previous scene's
  choice family (flags + choice labels) into the next scene's SceneWriter
  input exactly like `priorEncounterOutcomes` — author conditioned
  textVariants when the scene is written, not hope for them at repair. This
  is the responsiveness-62 fix at the source; the flag audit stays as the
  net. (Directly attacks the run's real ceiling.)
- **A2. Departure destination correctness**: (i) the ChoiceAuthor/SceneWriter
  departure directives must NAME the next scene's location and forbid naming
  any other destination; (ii) deterministic contradiction check — a
  departure/bridge beat naming a known location ≠ next scene's location →
  advisory finding; (iii) owner-time bounded retry when the departure judge
  flags a seam (one SceneWriter retry with the seam named — never a blocker).
- **A3. Route advisory classes into the existing criticFlags SceneCritic
  pass**: relationship-ledger "stage without payoff evidence", anchor
  planting misses, and departure misses become bounded scene-time critic
  rewrites (machinery exists; wire the classes).

### B — Craft-tier compilation (Wave C, now evidence-backed)
- **B1. Character signature atoms (F3)**: compile npcGuidance voice/visual
  signatures (platinum bob, iubita mea, herb-stained fingers, woodsmoke,
  stag-crest ring…) into advisory judge atoms on each NPC's intro scene +
  an intro-scene SceneWriter directive: land 2–3 signature details on first
  on-page appearance.
- **B2. Tone + lens contract (G7)**: compile the treatment's tone line
  ("champagne fizz on top, blood at the bottom") and the protagonist lens
  (food-writer appetite) into arc-phase StyleArchitect directives feeding
  SceneWriter, plus a ProseCraftJudge tone-fidelity concept (scored band).
- **B3. Earned-bond gate**: "after testing Kylie" — plan-time check that a
  relationship stage jump to `friend` within one scene requires a dramatized
  test beat (cost or vulnerability) in the scene plan; anchor onPageAction
  guidance demands the exchange, not the declaration.
- **B4. Foreshadow realization atoms**: planned foreshadow/twist beats
  (staged-rescue suspicion) compile to advisory judge atoms on their scenes
  (the F1 pattern); today nothing verifies they landed.

### C — Promotions (shadow evidence now exists)
- **C1.** Extend `auditAnchorCastOrder` to ownership metadata + scene
  descriptions naming the NPC (closes the Radu blind spot), then promote to
  plan-time AUTOFIX (strip the premature placement) — second occurrence.
- **C2.** G6 escalation budget becomes a judge-verified advisory atom on the
  episode-final scene ("at most one new threat signal"), since the prompt
  rule alone failed live. Also protects "Kylie owns the ending."

### D — Artifact/reporting fixes (cheap, do first)
- **D1.** Score caps consider BLOCKING issues only; exclude departure/
  transition fingerprints from the treatment-atom regex.
- **D2.** Quality report separates state divergence (243 fingerprints) from
  perceptible divergence (judge 62) — both true, different meanings.
- **D3.** Encounter `charactersInvolved` derives from encounter participants
  (collectEncounterParticipantRefs), not the scene's social cast.

### Sequencing
1. D1 + A2 (the score artifact and the teleport — both small, both misleading
   the reader/score today).
2. A1 (responsiveness at the source — the real ceiling).
3. B1 + B2 (the experiential gap: characters and tone).
4. C1 + C2 promotions · A3 · B3 · B4.

Meta-rule holds: everything lands advisory, scored, or write-time prompt
influence. Nothing new blocks. The blocking set stays frozen until W3.1
re-tiers it deliberately.
