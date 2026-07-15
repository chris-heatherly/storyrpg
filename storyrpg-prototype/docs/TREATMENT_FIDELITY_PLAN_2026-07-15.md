# Treatment Fidelity Plan — 2026-07-15

Context: `bite-me_2026-07-15T18-38-14` is the first packaged Episode 1 — the
reliability campaign's exit gate. The gap that remains is FIDELITY: the
package reproduces the treatment's events but not its secrets, its earned
relationships, its dramatic weight, or its interactive contract. This plan
turns the fidelity gaps into compiled contracts and generation-time steering
using machinery that already exists — no new blocking-gate classes beyond the
one that reuses the existing forbidden-meaning policy.

Verified worst defect: the invented final message ("My father will be
pleased. The bait worked perfectly. Welcome to the Dusk Club.") — fabricated
continuity, canon contradiction, and a season-secret reveal seven episodes
early, shipped through a passing final contract because the pipeline verifies
required meanings and forbidden LABELS but has no concept of forbidden
MEANINGS-until-episode-N.

Standing principles: LLMs write, deterministic systems enforce; craft lives in
the scored band, canon safety in the blocking core; every wave proves itself
offline against the archived package before a live run.

---

## Wave F1 — Canon & reveal integrity (blocking-capable; ~1.5d) — DO FIRST

### F1.1 Reveal-timing negative contracts
The treatment declares its reveal schedule: staged rescue → Ep5 (mirror),
Victor's nature → Ep5, Mika's placement → Ep7, Radu's pricolici → Ep6,
Stela's hunter lineage → Ep5. Compile these season secrets into
**forbidden semantic atoms scoped to every episode BEFORE the reveal**:

- Season plan gains `revealContracts`: `{ secretId, description,
  forbiddenMeanings[], revealEpisode, sourceRef }`, authored by the
  SemanticContractCompiler from the season spine + NPC secret fields (LLM
  decomposes; deterministic code validates episode bounds + source grounding).
- `narrativeContractCompiler` projects each contract into forbidden
  `semantic_judge` atoms on episodes `< revealEpisode` (final-regression
  scope; owner-stage scope for cliffhanger/aftermath scenes where the risk
  concentrates).
- Enforcement is FREE: forbidden-meaning-on-page is already the critical
  class in the terminal policy — blocks, routes to scene-prose repair with
  the meaning in the message, never ships.
- Examples for Bite Me Ep1–4: "the rescue is revealed as staged/bait";
  "Victor serves or reports to a larger power/family"; "Mika was placed in
  Kylie's life"; "anyone is confirmed as strigoi/pricolici/succubus".

### F1.2 Cliffhanger and aftermath author constraints
The bait message came from cliffhanger authoring reaching for a hook. Add to
the cliffhanger/final-beat prompts (SceneWriter aftermath + CliffhangerValidator
lens): escalate mystery WITHOUT confirming any season secret; never invent
canon (no new relatives, factions, prior interactions); a cliffhanger may
DEEPEN a question, never answer one early. CliffhangerValidator additionally
receives the episode's revealContracts as explicit prohibitions.

### F1.3 Fabricated-continuity guard
"His usual charming praise" referenced correspondence that never happened.
Add a continuity lens (ContinuityChecker prompt + final semantic criteria on
aftermath scenes): reader-facing prose may not reference prior interactions,
messages, or shared history that no earlier scene established.

**Offline proof before any live run:** replay the archived
`story.json` through the compiled Ep1 revealContracts — the bait message MUST
flag; the rest of the package must not. This is the fixture test.

## Wave F2 — Encounter agency & dramatic weight (~1.5d)

### F2.1 Protagonist-agency outcome contract (design rule → code)
Outcome tiers are PROTAGONIST outcomes, not NPC showcases:
- **success** — the protagonist prevails through her OWN agency (Kylie drives
  off the attackers herself; Victor witnesses).
- **complicated** — partial agency plus external assist (she nearly wins;
  Victor's arrival tips it), with a visible cost.
- **failure** — fail-forward: she is overwhelmed and the rescue lands at
  maximum intensity, with the psychological residue of having been saved.
All tiers CONVERGE on the same canonical story point (Victor speaks to her,
walks her home, vanishes) with tier-distinct twists and tier-distinct
psychological meaning.

Implementation:
- EncounterArchitect prompt: tier semantics rewritten protagonist-first, with
  the convergent-endpoint + divergent-residue rule stated explicitly.
- Deterministic check (extends the existing encounter POV/protagonist
  invariant): in the `success` tier's outcome prose, the protagonist must be
  the primary actor — an NPC-actor success tier is a blocking producer
  finding routed to the encounter re-author.
- Tier-distinct residue: per-tier relationship/flag consequences must differ
  (existing encounter outcome-flag machinery; validator asserts non-identical
  consequence sets across tiers — the "every response produces the same
  binding pact" class).

### F2.2 Set-piece depth for major encounters
"Ends too quickly": planned encounters carrying an episode's signature moment
get an escalation ladder in their `encounterBeatPlan` (attack → struggle →
turn → resolution → aftermath walk, for the rescue) sourced from treatment
language at plan time; EncounterSetPieceDepthValidator (exists) re-checks
depth. Rescue-specific: Victor's voice/visual anchors (F3.2) give the scene
its menace and intimacy.

## Wave F3 — Earned relationships & character anchors (~1.5d)

### F3.1 Stage-laddered intimacy inside the episode
The stage machinery exists (`relationshipPacingStagePolicy`: stageRank,
targetStage, blocked labels); the failure is plan-time compression — "the
three become friends" lands in one scene. Fix at plan time:
- The compiler expands "After testing Kylie, the three become friends" into a
  staged ladder across scenes: stranger → warm acquaintance (bookshop) →
  tested (a REAL trial: challenge + Kylie's authored response + a visible
  shift) → accepted/named (the toast). Per-scene `targetStage` caps with the
  existing blocked-label enforcement ("friend" stays blocked until the test
  scene completes — the machinery that already exists now gets a ladder that
  matches the treatment's chronology instead of fighting it).
- The "test" event's IR criteria require: a genuine challenge with stakes, a
  choice-bearing response from Kylie, and acceptance conditioned on it — one
  rooftop question cannot satisfy three criteria.

### F3.2 NPC anchor atoms (advisory + score cap, never blocking)
Compile each NPC brief's voice/visual notes into anchor atoms attached to
scenes where that NPC owns the dramatic turn: Victor's low precise voice,
charcoal suit, stag signet on the rescue; Mika's iubita mea and code-switch
on the club scenes; Stela's quartz pendant and herb-stained hands in the
bookshop. Injected into SceneWriter/EncounterArchitect prompts; judged as
advisory; misses cap the character-fidelity score. Fix the encounter cast
metadata bug the QA report surfaced (rescue lists Stela/Mika, not Victor) so
anchors reach the right prompt.

## Wave F4 — Cold open & interactive contract (~1d)

### F4.1 Cold-open craft bar
Current cold-open rules are structural (hook binding, coldOpenFunction text)
— nothing enforces DRAMA. Add the craft contract: the opening beat set must
be in medias res (action or sensory pressure before exposition), pose the
scene's dramatic question within the first two beats, and contain zero
abstract biography (the wound shown, not summarized). Prompt-first
(SceneWriter opening-scene directive + SceneCritic lens), scored via a
cold-open criterion in the ProseCraftJudge tags, capped not blocked.

### F4.2 Choice-mix and residue steering at authoring time
The season choice plan already assigns per-scene types; ChoiceAuthor isn't
held to it while writing. Feed the planned type as a hard prompt constraint
with one typed retry (83% expression / 0 strategic / 0 dilemma becomes
impossible to author silently); assert non-identical outcome consequences
across options (F2.1's residue check shares the mechanism). Responsiveness
caps continue to score what steering misses.

## Wave F5 — Instruments + the unblocked structural pair (parallel)

- F5.1 Verify (don't trust) two analysis claims: treatment-density "zero
  obligations on the opening" and obligation-ledger silence — 30/40 open
  after Ep1 of 8 is likely correct-by-design (season-scoped payoffs).
- F5.2 W3.1 scored-band demotion is now UNBLOCKED (first package exists):
  write the terminalPolicy table with F-wave severities baked in — forbidden
  reveals blocking; anchors/cold-open/choice-mix as caps.
- F5.3 W3.2 receipt continuity (owner→final verdict reuse) — halves judge
  cost before the fidelity waves add new judged criteria.

---

## Sequencing & verification

| Wave | Effort | Proof before live run |
|---|---|---|
| F1 | ~1.5d | Archived package replayed through Ep1 revealContracts: bait message flags, nothing else does |
| F2 | ~1.5d | Rescue encounter fixture: NPC-actor success tier rejected; identical-residue tiers rejected |
| F3 | ~1.5d | Plan compile shows staged ladder + blocked 'friend' until test completes; anchor atoms present on rescue |
| F4 | ~1d | ChoiceAuthor fixture authors planned strategic/dilemma types; cold-open judge criterion live in QA tags |
| F5 | ~1d | report:kills clean; judge call count drops (receipt reuse) |

Then ONE live bite-me run per two waves (F1+F2, then F3+F4), judged against
this package as the baseline: same reliability, strictly better fidelity.
Total: ~6.5 focused days. Nothing here adds a new blocking class outside the
existing forbidden-meaning policy; every craft dimension lands in the scored
band where the caps already proved they work (92.78 → 79 on this very run).
