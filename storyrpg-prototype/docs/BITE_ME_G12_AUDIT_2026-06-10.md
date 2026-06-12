# Bite Me G12 — Deep Audit vs Storytelling / Branching / Gameplay Goals

**Run:** `generated-stories/bite-me-g12_2026-06-10T16-29-51` (3 episodes, completed 2026-06-10 11:14)
**Pipeline QA said:** 87/100, `passesQA: false` (2 ep3 continuity errors). **This audit says: NOT SHIPPABLE** — the pipeline QA caught a small fraction of the real defects and rubber-stamped the worst ones (incremental QA passed 18/18 scenes at ~1ms each, including the broken ep1 encounter).

Method: five parallel deep-read audits (one per episode against the treatment + quality contract + craft skills; one branching-graph traversal with scripted flag analysis; one gameplay/encounter audit including runtime-render verification against `storyEngine.ts` / `EncounterView.tsx`). All findings below are quote- or script-verified.

---

## Verdict

The **scene tier is the best this pipeline has produced** — voice, stakes triangles, playable failures, fiction-first discipline (0 mechanics leaks in my own re-scan), opener diversity fixed (11.4% second-person openers vs 28–39% in g10), choice density within contract, and real structural branches with working convergence residue in several places.

But the run fails on three systemic axes:

1. **The ep1 encounter has the exact dual-protagonist role collision + context starvation that sank endsong g12.** Bite-me is NOT clean on this defect class — it just happened to hit ep1 instead of all episodes.
2. **The reconvergence-residue economy is ~1/3 functional.** 77 of 110 flags are write-only; encounter outcome residue is dead in all 3 episodes via a flag-id spelling mismatch; the tint tier is 100% inert; the flagship ep1→ep3 blog chain is broken.
3. **Canon corruption at season-architecture level**: reveals budgeted for eps 5–8 are burned, fabricated, or contradicted in eps 1–3, and both episode-ending cliffhangers are path-gated so half of players never receive them.

---

## A. Storytelling blockers

### A1. Ep1 encounter: role collision + premise reset (root cause: encounter context starvation)
`treatment-enc-1-1` casts **Kylie as an NPC at the table while the player (also Kylie, same backstory) arrives as an unnamed stranger**:
- "The center seat is yours. The warm one — Kylie — leans in… 'Tell us something true,' Kylie says." Relationship consequences pay `char-kylie-marinescu` (~12 edges). `npcStates` lists "Kylie Marinescu — wary" in **all three** encounters, and `EncounterView.tsx` renders npcState badges — the player sees herself as an NPC in the HUD.
- goalClock/stakes misgender her: "Kylie stops observing and starts authoring the night on **his** own terms… two suitors leaning toward **him**… a cold hand finds **his** throat in the dark."
- Timeline rewinds to arrival night ("two suitcases parked at coat-check… six strangers, one bottle, and your name still unspoken") **after** three scenes with Mika/Stela and the 1 a.m. Cișmigiu attack.
- Radu (a stranger until ep2 per treatment) is seated at the table as a buddy; Stela is rewritten as a catty rival who "means to keep you small" and is intimate with Victor; "the warm one" is Kylie in one branch and Radu in another.
- Encounter title/phase names are the raw treatment anchor **truncated mid-word** ("Two anchors, light then dark — the rooftop bar at sunset on "), and one phase description is naked design-doc prose.

Eps 2–3 encounters are well-grounded in prior scenes (rescue route, blog codename, Ileana setup, mantle photo), so the starvation is not uniform — but the failure mode is confirmed present in bite-me, strengthening the endsong-g12 diagnosis: **the encounter generator receives a truncated treatment seed and insufficient cast/timeline/protagonist context.**

### A2. Pronoun/POV integrity — every prior defect class recurs
- **Victor is "they/them" across the entire ep2 encounter tree** (~60+ player-facing instances), flickering against "he" in sibling fields and in the same line ("Victor tilts **their** head… tells you **he** won't say which"). 4 stray "they" in ep3's maze.
- **All ep2/ep3 encounter OUTCOMES and STORYLETS are third person** ("She got the interview, mostly", "Victor's hand stays in hers… Kylie doesn't pull away") — player-facing via `storyEngine.ts:430`. Ep1's are correctly second person.
- **POV collapse at the ep2 climax beat** (`s2-6-beat-3-payoff-2`): "She posts *Three Dates and a Tow Truck* at 11 p.m.… Kylie sets the phone face-down" — plus invents a wrong surname (**"Victor Szalai"**) and a **profile photo** for a man the season defines as unphotographable since 1962.
- **Wrong-body consequence** (`s3-4-beat-3b-payoff-1`): Kylie's wine choice lands in "the back of **Mika's** throat", in third-person pluperfect — the gen-10 class verbatim.
- Mika is they/she-unstable across ep1 beats; "Third floor," Kylie says (third-person drift) in s1-2-beat-2.

### A3. Canon / season-architecture corruption
- **Carmen Iliescu unmasked in person in ep2 scene 1** (budgeted: anonymous account until ep6) — and her in-person Ileana warning pre-spoils the episode's own cliffhanger DM.
- **INFO-B (staged rescue) confirmable from Victor in ep2** ("Fine. No reframe." / "'Three,' Victor corrects, automatic") with fabricated attribution "**Stoian sent them**" — contradicting canon (coven enforcer, not Radu's pack) and collapsing the season's withheld secret.
- **Maze fabricates: Stela was Victor's bride** ("The bride is Stela… 'You,' you breathe") — the 1961 fiancée is Veronica (ep5/ep8 reveal). Hijacks both characters' arcs.
- **Maze kills/relocates the Ileana thread** ("Whatever took Ileana is still hungry… that's where she went") — same-episode contradiction (she's at this party crying in the powder room in s3-3) and makes ep4's "alive in Constanța" impossible.
- **Radu's scarf pre-burned twice**: ep1's black-roses card carries Radu's ep3 note verbatim ("Thought you'd be cold"), and maze paths have Kylie pocketing "Radu's scarf" in the hedges — destroying the season's best cliffhanger object (which the s3-6 doormat beat otherwise delivers superbly).
- **Genre flip two episodes early**: the maze confirms no-heartbeat, mind-control, "The cold is me" — treatment holds the supernatural off-page until ep5.
- **Blog counter runs backward**: ep1 ends on-page at 84,212; ep2 opens at "forty-three thousand" (treatment: 80K→130K).
- "Dusk Club" (canonized in ep1 as the friend group's name) is misused in ep2 as Victor's venue.

### A4. Timeline inversions
- **Ep1**: virality (84,212 reads, Berlin mood board, the "Mr. Midnight" name) is rendered **before** the publish/hold choice exists — making "hold overnight" a false choice; "midnight" homecoming after a 1 a.m. attack.
- **Ep3**: the Sunday-breakfast scene (s3-4) narrates the maze as "last night" yet **precedes** the maze in the graph; the cast then departs "past midnight" right after the maze — Saturday/Sunday amputated, and the treatment's Sunday-breakfast "very private man" blog ask (INFO-E's opening shot, the episode's thematic payload) **never happens** (exists only in reminderPlan metadata).

### A5. Path-gated cliffhangers (both episode hooks)
- Ep2's two-DMs cliffhanger (Casa Stelarum invite + "Ileana is missing… Don't go") exists **only on the decline branch** (`payoff-2`); the go-to-club branch ends with no plot turn.
- Ep3's scarf-on-doormat + courtyard-dog cliffhanger exists **only in `payoff-2`**; treatment says "all paths reconverge on… the scarf on the doorstep."
Half of players end both episodes without the forward hook that motivates the next one.

### A6. Stub/meta-leak prose shipped to players (gen-3/5 regression)
- **ChoiceAuthor fallback outcomeTexts on 3 pivotal choices** — ep1 s1-4 choice-3 (the *first direct question to Victor*: "who are you?" resolves as "You come back with less than you brought"), ep2 s2-4 ask-stela-directly (identical strings), ep3 s3-4 find-Mika. Plus shipped reminderPlans: "The next scene should remember this choice."
- **echoSummary strings shipped as full beat-replacement textVariants** (11+ instances across all eps): flags like `kylie_stops_pretending` replace entire establishing beats with one-liners ("You asked the real question. Stela answered it." appears as the full text of FOUR different beats). Players on those paths lose whole scenes.
- Treatment beats dropped wholesale: ep1 cold open + Stela-dream cliffhanger; ep2's three terrible dates, Radu meet-cute (recalled, never dramatized), "The Mountain" codename choice, tarot; ep3's drive-north cold open, scream/run/freeze/fight attack choice (ep1), walk-home threshold beat.

---

## B. Branching findings

Graph skeleton is **clean**: 0 unreachable scenes/beats, 0 dangling refs, all paths terminate; blueprint→realized parity confirmed (the identical 6-scene shape per episode is template-enforced, not LLM laziness). Each episode has one real structural branch (650–820 words of exclusive detour prose) with working convergence residue. But:

1. **Encounter outcome residue dead in all 3 episodes** (blocker). Outcomes set `encounter_<enc.id>_*` where `enc.id` carries an extra `-encounter` suffix (`seedEncounterOutcomeFlags`, `src/ai-agents/utils/encounterOutcomeFlags.ts`); post-encounter scene variants are keyed on the *scene* id (`encounter_treatment-enc-1-1_escape`); the runtime engine sets a third spelling (`encounter.<id>.outcome.<o>`, `src/engine/encounterConsequences.ts`). Setter ≠ consumer everywhere: all 4 outcomes funnel into identical post-encounter prose. ~300–390 authored words/episode never render. `findEncounterOutcomeDesyncs` can't see it (greps by `enc.id` prefix).
2. **Flagship ep1→ep3 chain broken** (blocker). Ep1's publish/hold finale sets booleans `blog_post_published_midnight`/`blog_post_held_overnight`; ep3's three authored variants read `blog_post_timing` ∈ {published, scheduled, skipped} — never set, wrong vocabulary, includes an option the episode doesn't offer. The title decision of ep1 is silently forgotten.
3. **Tint tier 100% inert** (major). 28 `tint:*` flags set; 0 match `identityEngine.ts`'s `TINT_TO_IDENTITY` exact keys (run: `tint:bold/pragmatic/honest`; engine: `tint:boldness/pragmatism/honesty`); 0 gate any variant. ~24% of the consequence budget produces zero effect.
4. **Flag economy: 110 set / 33 read / 77 write-only** (some legitimately deferred to eps 4–8 per ledger windows, but the in-range losses include the ep1 Victor-first-meeting trio, ep2's closing dilemma flags, and 5 conditions that read flags **never set** (`stela_warned_at_bookshop`, `writing_glasses_worn` — statCheck bonuses that can never trigger; `kylie_logs_observations` near-miss of `kylie_logs_for_now`).
5. **Divergence validator's 1.0 is gamed by construction** (major). `pathSimulator.ts:228` fingerprints terminals as the full flag JSON; write-only flags guarantee distinctness. `cosmeticChoicePoints: 0` measures state-space, not player experience.
6. **Callback ledger inflated by hook-id collisions** (major). Hooks keyed `later:choice-1` merge flags from different episodes' choices sharing generic ids; sibling-credit marks unread flags "resolved." "54/79 resolved, 0 overdue" overstates coverage.
7. **Branch-state corruption on the wine chain**: `treatment_branch_the_country_house_wine…` set as boolean by *closing a laptop* (s3-1), asserted in maze prose for players who never drank, then overwritten with strings (`drank_fully` after `refused_asked_for_white`). Season Branch C (Consort) is unreliable.
8. Choice-type mix on the slice: expression over-target (+11 pts), relationship under (−8 to −16); consequence-budget drift is secondary to the tint tier being functionally dead.

**Working residue (the pattern to keep):** keycard accept/decline → s1-3/s1-6 variants; herbs → s2-3/s2-6; quartz → **cross-episode** ("the quartz from Stela still on your nightstand", ep2); `kylie_names_for_now` (ep2) → ep3 "*for now* still sitting".

---

## C. Gameplay findings

1. **Encounter structural shallowness** (major): every encounter is 1 phase / 1 beat / depth-2 choice tree; the c4 root option is terminal at depth 1 in all three episodes — **the bottleneck set-piece can be won in one click with zero consequences** (ep1 c4: "'Sit by me,' she says" → TERMINAL:victory). Max attainable goal ticks = 5 of 6 segments, so the rendered OBJECTIVE clock can never visibly complete even on perfect play. escalationTriggers fire at threat-75 on trees that end before threat can reach it.
2. **Skill monoculture** (major): inside encounters perception holds **57%** of choice slots (53/93); scene-level checks: perception 36–41%, only 4–5 of 8 skills, **0 hard checks**, all difficulties 45–55 — checks differentiate texture, not odds; "always pick perception" is the meta.
3. **Dead runtime channels** (major): `reactionText` and `witnessReactions` have no consumer in engine/reader code — witness reactions reach the player only where also baked into outcomeTexts/payoffs. Spot-check: ~half of claimed witness reactivity is metadata-only (e.g. s1-2 quartz Mika reaction, s1-6 "Mika texts before the ink is dry" — never rendered).
4. **npcStates/escalationTriggers are boilerplate** (major): all 17 npcStates identical template ("responds to aggression", empty tells/shifts) — and they render as HUD badges, including "Kylie Marinescu — WARY" (see A1).
5. **Incremental QA rubber-stamp** (process): `06b-incremental-aggregate.json` passed 18/18 scenes, 0 issues, ~1ms/scene — including the broken ep1 encounter. Whatever mode it ran in catches nothing.
6. **Verified clean**: fiction-first (18 regex hits, all false positives — "coat-check", "comments roll in"); pacing (first choice 42.6s, avg gap 65.4s, every scene has a choice point, no deserts); stakes triangles authored on every choice point and uniformly strong; failure is consistently playable at scene level (s1-4 notes-app reflex, s1-6 screenshotted-draft are model examples); ep3's maze is the craft target for environmental threat (candles dying as the dark closes) and romance/danger duality (kiss on success ticks the threat clock).

---

## D. What's genuinely good (keep)

- Scene-tier prose voice: "Three women ahead of you are wearing heels that could file tax returns."; "the one who keeps score instead of playing."
- The quartz consent scene (3-tier consent exceeds the treatment spec; failure residue "the ward sits lighter than it should").
- Carmen's entrance ("immediately finds the wall. Not the table. The wall.").
- The booth surveillance beat ("He quoted the interior line. The one buried in paragraph three.").
- The doormat ending ("…no moment where an address was exchanged. No moment you can find. The wool is very soft.").
- Mika's missing-hour partialVictory ("'Where were you?' 'Bathroom.' The lie sits between them like cold air.").
- Victor's strigoi tells as pure behavior ("He pours his own out into the grass").
- Sentence-opener fix validated: 11.4% (target met; g10 was 28–39%).

---

## E. Remediation priorities (rough order)

1. **Encounter context assembly** (fixes A1 root cause; same fix endsong g12 needs): pass full cast bible + protagonist identity/pronouns + episode-so-far timeline + untruncated anchor into encounter generation; assert protagonist ∉ npcStates; validator: protagonist name must not appear as an NPC actor in encounter prose/consequences/npcStates.
2. **Flag-id unification** (fixes B1/B2/B3): one canonical spelling for encounter outcome flags across seeder/author/engine; choice-flag vocabulary contract (setter and consumer generated from the same source); tint vocabulary aligned with `identityEngine`; lint: every conditioned flag must have a setter, every player-choice flag a consumer-or-ledger-window.
3. **Pronoun/POV gate on encounter JSON fields** (A2): run the pronoun + POV validators over goalClock/threatClock/stakes/outcomes/storylets/npcStates text, not just beats; enforce second person in outcome/storylet prose.
4. **Cliffhanger reconvergence rule** (A5): episode-ending hook beats must be on the post-convergence trunk, never inside one payoff branch. Validator: final-scene hook content reachable from all paths.
5. **Canon guard for reveals** (A3): information-ledger windows enforced at generation time — encounter/scene authors must receive "forbidden reveals" (INFO items with window > current episode) and a validator should grep realized prose for them.
6. **Stub fallback hard-fail** (A6): ChoiceAuthor fallback strings and echoSummary-as-beat-variant should fail the build, not ship.
7. **Encounter depth contract** (C1): minimum 2 phases / depth-3, no zero-consequence terminal at depth 1, goal clock must be completable.
8. **Skill spread + witness channels** (C2/C3): cap any one skill at ~35% of encounter slots; either render reactionText/witnessReactions in the engine or stop authoring them and bake reactions into outcomes.
9. **Validator honesty** (B5/B6/C5): divergence fingerprint should hash *rendered text reachable*, not flag JSON; ledger hooks need episode-qualified choice ids; fix or retire the no-op incremental QA mode.

## F. Validator blind-spot summary

| Shipped defect | Validator that should have caught it | Why it didn't |
|---|---|---|
| Kylie as NPC + he/him in ep1 encounter | incremental QA / pronoun gate | QA ran in no-op mode; pronoun gate doesn't scan encounter JSON fields |
| Victor they/them across ep2 encounter | NPC_PRONOUN (known FP-prone, off) | not run / scoped to beats |
| Encounter residue dead | `findEncounterOutcomeDesyncs` | greps by `enc.id` prefix; consumers keyed by scene id |
| blog_post_timing never set | callback/flag validator | no setter/consumer cross-check |
| Tint tier inert | consequence budget validator | counts allocations, never checks engine vocabulary |
| Divergence cosmetic | divergence validator (1.0) | fingerprints flag-state, write-only flags game it |
| Virality-before-publish, breakfast-before-maze | continuity QA | episode-final QA caught adjacent symptoms, missed graph-order inversion |
| Stub outcomeTexts | stub detector (built g5) | strings shipped anyway — gate off or pattern set stale |
