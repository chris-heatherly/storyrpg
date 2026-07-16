# Treatment gap analysis — bite-me_2026-07-15T20-44-49 (systemic causes)

Second-ever packaged episode; first through the repair-persistence machinery.
Pipeline score 79 (prose 67, responsiveness 62). Codex's manual estimate ~74.
This analysis verifies every claimed gap against the artifacts and maps each
to a PIPELINE MECHANISM — the fix is always the mechanism, never the content.

What went right systemically (baseline to protect): the full treatment spine
is on-page and in order; both men are staged correctly at the rooftop; the
encounter preserves protagonist agency; the restage catch + repair worked as
designed; conditional textVariants exist and fire (aftermath reflects the
s1-4 founding choice).

---

## G1 — Transitions contract the ARRIVAL, never the DEPARTURE

**Evidence.** s1-5 (rooftop) ends: "You feel the man's gaze linger for a
moment longer before it's gone." Next thing the reader sees: "As the chill of
Cismigiu Gardens bites through your coat…". No leaving, no reason to walk, no
reason to cut through the park. Yet the plan HAD a transition contract for
exactly this seam — `task:transition:ep1:s1-5:to:treatment-enc-1-1:bridge` —
and it passed, because its ONLY atom is `location_entry` ("Orient the
receiving scene at Cismigiu Gardens", literal match, receiving side). The
contract asks "did the next scene say where it is?" and never "did the
previous scene end with a motivated exit?"

**Systemic fix.** The transition compiler emits a PAIRED atom set:
- `location_exit` on the SOURCE scene's closing surface (owner: scene_writer
  of the source scene): a semantic atom — "the protagonist decides to leave,
  with a motive and a destination intent" — judged, not lexical.
- The existing `location_entry` on the target (unchanged).
SequenceDirector prompt rule to match (author the exit; validators enforce).
This covers every scene change in every story, which is the ask: transition
beats whenever the protagonist changes location, answering why leave / why
this route.

## G2 — Reveal contracts cover IDENTITY secrets only

**Evidence.** F1 worked as built: 4 reveal contracts (Victor strigoi, Stela
hunter, Radu pricolici, Mika succubus) × all 8 scenes, forbidden semantic
atoms, final-regression phase. The cliffhanger still leaked, because its
three comments leak things no compiled contract names:
- `VictorV` knows the private "Dusk Club" pact (knowledge-boundary breach —
  nobody outside the three women knows the name).
- `Stela_Shield` publicly performs Stela's protective role and names Mika as
  exposed ("a target on Mika's back. On all of us") — Ep5/Ep7 material,
  leaked through a HANDLE the judge can't attribute to the cast member.
- `ShadowWatcher_7` uses "The Mountain" before anyone coins it (Ep2 event).

**Systemic fix.** Three new contract classes in the reveal compiler:
1. **Knowledge-boundary contracts**: NPC X must not demonstrate knowledge of
   fact Y before its treatment placement. The continuity knowledge tracker
   already models who-knows-what; compile treatment placements into
   forbidden atoms per scene.
2. **Codename-coinage ordering**: a codename is a coined artifact; forbid its
   use anywhere before its coining event. Deterministic and cheap — coinage
   events are treatment-explicit ("names Victor 'Mr. Midnight'", "a new
   codename for The Mountain" in Ep2).
3. **Alias attribution rule for the judge**: screen names / handles
   attributable to a cast member count as that character speaking.

## G3 — Choice consequences are write-only: no consumption obligation

**Evidence.** 38 flags set in the episode; 21 never read anywhere, including
the episode's THEMATIC spine choice (`dad_post1_tone_warning/mystery/expose`
— the observer-vs-author polarity) which the viral aftermath ignores
entirely. Asymmetry proof that the machinery works but nothing obligates it:
aftermath beats condition on `dusk_club_founded_on_writing` and
`…_on_parties`, but the third sibling `…_on_vulnerability` has NO variant —
one of three founding paths silently loses its reflection.

**Systemic fix.** Flag-consumption ledger — the inverse edge of the existing
obligation-ledger check ("seed declared but no choice sets it"):
- Every plan-declared consequential flag needs ≥1 downstream read
  (textVariant condition, encounter requirement, or choice gate). Episode-
  scope flags must be consumed in-episode; season-scope flags register as
  Ep2+ obligations in the season ledger (tint:* etc.).
- Sibling symmetry: if any flag in a mutually-exclusive choice family gets a
  conditional variant at a site, all siblings get one there.
- Enforced PLAN-TIME (cheap graph check, routes to ChoiceAuthor/SceneWriter
  variant authoring) — never a new final-contract abort class.

## G4 — Reconvergence without residue; our own projector enforces sameness

**Evidence.** All nine outcome tiers of the s1-4 Dusk Club choice end in the
identical sentence ("A smile passes between the three of you, a silent
pact…") — that is the choice-resolution repair handler's fingerprint: it
projects ONE shared resolution TEXT into every tier. The bond lands as a
naming ceremony regardless of what the player said; QA's responsiveness 62
flagged the same scene.

**Systemic fix.** The shared-resolution projector must project shared
MEANING, not shared text: the reauthor prompt demands the same convergent
fact (the pact forms) dramatized with tier-distinct texture and cost —
identical to the protagonist-agency outcome-tier principle already adopted
for encounters (F2). Plan-time complement: bottleneck scenes compile residue
atoms per inbound branch/outcome family (the reconvergence-residue craft
rule, made a contract).

## G5 — Season anchors satisfied by metadata, not on-page acceptance

**Evidence.** "Stela's protection becomes a live anchor": on-page evidence is
a quartz pendant description and a face-down card — Kylie never accepts any
object, invitation, or threshold action (and the world rules say consent is
the mechanism). "Radu's first sighting" anchor: staged TWICE — an unnamed
scarred, woodsmoke-scented man with a full three-way gaze choice in s1-2
(flags `kylie_held_radu_gaze` etc.), then again at the rooftop as planned.
An internally generated introduce-Radu obligation outran the treatment's
sighting anchor, and nothing owns "first sighting" as an event.

**Systemic fix.**
1. **Anchor→atom compilation**: every "live season anchor" in the episode's
   likely-consequence line compiles to a realization task with a concrete
   on-page ACTION atom (accept/receive/refuse an object; cross a threshold),
   semantic-judged. Metadata can never satisfy an anchor.
2. **First-sighting anchors become owned event cues** so the existing route
   chronology machinery (which correctly caught the restage this week)
   also catches PREMATURE staging. The NPC-introduction scheduler must
   consume anchor constraints: it may not schedule an on-page intro earlier
   than the anchor's owning scene.

## G6 — Cliffhanger escalation is unbudgeted

**Evidence.** Treatment: three glamorous episodes, "a single horror thread
under the champagne"; the scene should keep the viral victory and end on ONE
precise unsettling signal. Delivered: three coordinated threats at once.

**Systemic fix.** Cliffhanger contracts (F1's constraint slot) gain an
escalation budget: at most one new threat signal in an episode-final beat,
with the arc-phase tone (Champagne/Mirror/Blood) compiled from the treatment
into the constraint. Judge-verified, scored-band — not a new blocker.

## G7 — Protagonist lens never shapes perception

**Evidence.** "Food writer" is biographical wallpaper; Bucharest registers as
generic beautiful architecture. The treatment's premise ties reinvention to
appetite.

**Systemic fix.** Identity-derived perception contract: StyleArchitect
compiles an attention vocabulary from the protagonist brief (what this
person notices: taste, smell, texture, appetite) into SceneWriter's style
directives, and QualityScore v4 gains a lens-fidelity concept under
ProseCraftJudge. Scored, never blocking.

## G8 — Mechanical prose defects ship

**Evidence.** "I'm Stela Pavel, Welcome." / "The man you fled, Was he
worth…" — comma splice + capitalized continuation inside dialogue; stray
spaces before punctuation; repetitive "You…" openers (opener diversity
tooling exists but evidently under-weighted).

**Systemic fix.** A deterministic mechanics linter (comma-before-capital
inside quotes, space-before-punctuation, doubled commas) detecting at scene
time and routing an LLM micro-rewrite (deterministic code never authors
prose, per the standing rule). Cheap, high-precision patterns only.

## G9 — Quality evidence can be stale relative to the packaged payload

**Evidence.** The post-repair QA report grades the older "You hit Publish"
beat; the package contains the three-comment version written ~5 minutes
later. The 79 is therefore partially evaluating text the reader never sees.

**Systemic fix.** Package-time evidence sync: the package stamps the
candidate story hash; every QA/judge artifact carries the candidate hash it
graded; mismatched artifacts are marked STALE in the quality report and
ledger, and judged pillars re-derive scoped to changed scenes. (This is the
W3.2 receipt-continuity design applied to QA — carry-forward's hashing gives
us the keys for free.)

---

## Wave A status (2026-07-15)

- **G1 SHIPPED** (f9887ce0): departure tasks compiled per location-changing
  transition (advisory); SceneWriter MOTIVATED DEPARTURE directive (incl. the
  choice-point case the old pre-encounter handoff skipped); ChoiceAuthor
  outcome-tier departure handoff; possibleNextScenes carries location.
- **G3 SHIPPED** (01a546df): flagConsumptionAudit wired as final-contract
  warnings; replayed on the packaged story → 7 findings matching this
  analysis exactly.
- **G5 SHIPPED** (f697978e): `compileAnchorContracts` binds each episode's
  likely-consequence anchors to {owningSceneId, onPageAction, npcName?,
  firstSighting?} by meaning (schema-constrained scene ids; best-effort like
  reveals). Anchors project to advisory judge-verified planting tasks on the
  owning scene, and `auditAnchorCastOrder` warns when an NPC is cast before
  their anchored first sighting — offline-proven on this run's blueprint
  (fires on Radu-in-s1-2, ignores post-sighting casts). Note: compilation
  runs on FRESH analyses only; resumed plans skip it.

## Sequencing recommendation

Wave A (plan-time compilations on existing rails — highest leverage):
G1 departure atoms · G3 flag-consumption ledger · G5 anchor atoms + sighting
cues.
Wave B (extends F1/F2 machinery): G2 reveal classes · G4 residue-distinct
projection · G6 escalation budget.
Wave C (scored-band, needs W3.1 banding first): G7 lens concept · G8
mechanics linter · G9 evidence sync.

Meta-rule, learned this week at cost: every new check lands advisory,
scored, or plan-time-cheap. Nothing joins the blocking set without shadow
evidence — the 11.5% July success rate was compounding blockers, and this
run only packaged because we spent a week un-compounding them.
