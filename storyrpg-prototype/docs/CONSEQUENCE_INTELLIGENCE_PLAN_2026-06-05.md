# Story-Aware Consequence Intelligence — Design Plan

**Date:** 2026-06-05
**Status:** Proposal (no behavior changed yet beyond the bug fix in Part 0)
**Scope:** `seasonBudgetAllocator.ts`, `SeasonBudgetValidator.ts`, `scenePlan.ts`,
the thread/arc/relationship planners, and a new plan-time *charge* pre-pass.

> **North star (non-negotiable):** we are telling a great story first. Skills,
> attributes, relationships, flags, scores, tags, and inventory are *important
> data* — they are how we *measure and materialize* drama — but they never become
> the *reason* a moment matters. Story intent drives; stats confirm. None of this
> machinery is ever visible to the player (fiction-first contract,
> `docs/STORY_QUALITY_CONTRACT.md`).

---

## Part 0 — Where we started (the bug, now fixed)

The allocator (`tierFloor`) only floored **branch-point** encounters at
`branchlet`; the validator required **every** encounter to be `≥ branchlet`. So
the allocator's own output failed its own validator, and `GATE_SEASON_BUDGETS=1`
threw spuriously on a valid spine.

**Fixed:** `tierFloor` now floors *all* encounters at `branchlet`
(`isEncounter(u)`), with branch-points still assigned their `branch`/`branchlet`
slots first. Docstrings in `seasonBudgetAllocator.ts` and the `ConsequenceTier`
type in `scenePlan.ts` updated to match; a regression test runs the repro
(8 encounters incl. 3 branch-points + 40 scenes) through allocate→validate and
asserts `valid: true`. This plan is what we build *on top of* that fix.

---

## Part 1 — The problem with "slot-machine" allocation

Today consequence tier is decided by **budget supply**: "we have N branchlet
slots, hand them to the heaviest-demand units." Tier is a function of *how much
budget is left*, not *what the moment is*. Two consequences:

1. **Hollow forks.** A branchlet can land on a scene with nothing behind it.
2. **Mis-calibration under encounter load** (see Part 3, Layer D): with 8
   weight-3 encounters all `≥ branchlet`, encounters alone occupy **37.5%** of
   weighted heavy tiers against a 25% unified target — there is *no* headroom for
   non-encounter "major" choices, and the season can never hit target.

We want allocation driven by **good storytelling**, with the season % demoted
from *driver* to *balance guideline*.

---

## Part 2 — Two axes of weight

A moment's consequence weight has two independent sources:

| Axis | Question it answers | Computed from |
|---|---|---|
| **Positional** | What *kind* of moment is this, and where in the spine? | `narrativeRole`, episode `structuralRole` |
| **Dramatic charge** | How much accumulated, primed state *discharges here*? | thread payoffs, relationship/identity/score trajectories crossing thresholds, setup in-degree, delayed-consequence landings |

```
magnitude(unit) = max(positional(unit), charge(unit))
```

The best majors are where **both** align (a `turn` scene sitting on a relationship
tipping point). Charge alone can elevate a structurally-modest choice — the
betrayal that reads as "just" a relationship choice but detonates three episodes
of accumulated bruises. Position alone can locate *room* for divergence but never
*earn* it.

---

## Part 3 — Positional logic (Layers A–D)

### Layer A — Eligibility bands (hard, per choice type)

| Unit | Band | Notes |
|---|---|---|
| `expression` | `callback` only | unchanged invariant; expression *plants* identity charge (Part 5) |
| encounter, **branch-point** | `branch` (or `branchlet`) | durable forks live here |
| encounter, non-branch-point | `branchlet` (→`branch` at pinch2/climax) | escalate at peak stakes |
| `relationship`/`strategic`/`dilemma` | per magnitude → Layer B | the "major vs minor" decision |

### Layer B — Magnitude score → major vs minor (non-encounter)

`positional` magnitude in [0,1] from signals already on `PlannedScene`:

| Signal | Contribution | Why |
|---|---|---|
| `choiceType` base | dilemma .50 · strategic .35 · relationship .30 | dilemmas are value-tests |
| `narrativeRole` | turn +.30 · payoff +.20 · development +.10 · setup +.05 · release 0 | the turn is the episode's hinge |
| `setsUp.length` | up to +.25 | plants many later payoffs → load-bearing |
| `paysOff` non-empty | +.10 | discharges an earlier thread |
| explicit `stakes` set | +.10 | authored stakes = weight |

`magnitude ≥ τ_major` → heavy band eligible; else light band. `τ_major` is
**auto-solved** so the count of standard-scene majors matches the reserved
non-encounter heavy allotment (Layer D) — not a hand-tuned constant.

### Layer C — Episode posture gates the heavy tiers (reconvergence logic)

A durable `branch` needs runway to pay off before the story forces a merge.
Tentpole beats are merge points by design.

| Posture | Roles (8-ep map) | Non-encounter policy |
|---|---|---|
| **Convergent** | hook, midpoint, climax, resolution, falling | major capped at `branchlet`; resolution → `callback`-dominant (no runway) |
| **Open-field** | plotTurn1, pinch1, rising | major may reach `branch` |
| **Open-field, short** | pinch2 | major → `branchlet` (reconverges *into* climax) |

→ Major **non-encounter** branches belong in **plotTurn1 / pinch1 / rising**.
Encounters carry durable branches *anywhere* (built-in outcome trees).

### Layer D — Two populations, two policies (the calibration fix)

Stop measuring encounters against a scene-texture %. Budget two populations:

- **Encounter spine** — governed by *invariant*: branch-point → `branch`; others
  → `branchlet` (→`branch` at pinch2/climax). Encounters are *meant* to be heavy.
- **Standard-scene texture** — governed by the season %, re-expressed over scene
  weight only, e.g. **callback 60 / tint 30 / branchlet 8 / branch 2**. This
  reserves a small, deliberate number of non-encounter majors.

The validator checks each population against *its own* target and reports total
heavy-tier mass against a **spine-derived** band
(`encounterWeight/total + sceneReserve`) instead of a fixed 25%.

---

## Part 4 — Dramatic charge (Layer E) + the hollow-branch ban

### The charge model (computed over the scene graph, at plan time)

`charge(scene)` accumulates from authored intent already on the plan:

| Source | From | Reads as |
|---|---|---|
| **Thread payoff load** | `NarrativeThread.payoffs` here × `priority` (major≫minor); `kind:'promise'` discharging = max | a stakes-commitment detonating |
| **Relationship threshold crossing** | a `RelationshipTrajectoryTarget` dimension crossing a tipping point near this scene | trust hitting the betrayal cutoff |
| **Identity axis crossing** | an `IdentityAxisTarget`/`ArcMilestone(phase: turning_point\|commitment)` crossing its midpoint | a character-defining turn |
| **Score threshold crossing** | a story score (suspicion, corruption) crossing an authored cutoff | a meter tipping over |
| **Setup in-degree** | count of earlier scenes whose `setsUp` points *into* this scene | many plants converging |
| **Delayed-consequence landing** | `DelayedConsequence` resolving here | butterfly effects arriving |

Charge is a **flow along the scene graph**, not a per-row scalar: Pass 1
propagates charge forward along setup/payoff + trajectory + delayed-consequence
edges and accumulates it at convergence nodes; Pass 2 assigns tiers. That graph
pass is the real architectural change from the slot machine.

### The two rules that make it bite

**Rule 1 — Charge elevates.** High inbound charge forces a unit into the heavy
band regardless of `choiceType` base. The betrayal becomes a `branch` because a
major `promise` thread pays off and trust crosses its threshold there.

**Rule 2 — No charge, no branch (hollow-branch ban).** A standard-scene unit may
occupy `branchlet`/`branch` only if `charge ≥ τ_charge` *or* it is an encounter.
This **bans forks with nothing behind them**. A branchlet becomes *unallocatable*
unless upstream texture has charged it.

Together these make the light beats **ammunition assigned to a specific
detonation** — and the consequence budget becomes *bidirectional* with the
thread/arc design: a scene marked major but under-charged is either **demoted**
(branch → tint) or **charged up** (plant upstream tint beats / `setsUp` edges /
attach a `promise` thread). The deficit is a work-list for the planners.

---

## Part 5 — How the state systems factor in

The earlier draft of this plan split state systems into "charge carriers" and
"capability gates." That was too clean and it was wrong about skills/attributes.
The real distinction is not *which system* — it is **value vs. trajectory**, and
**every quantitative dimension has both**:

> **The duality.** A dimension's *snapshot value* is a **gate** (can you pass /
> reach / afford this *right now* — access and odds). The same dimension's
> *trajectory crossing a threshold* is **charge** (a dramatic arc paying off —
> "earned").

So skills and attributes are charge carriers too. The classic loop — **hit a wall
you can't pass → go grow → return and overcome it** — is a competence *arc*, every
bit as dramatic as a relationship souring. I under-counted it. Fixed below.

### Role taxonomy (each system, both lanes)

| System | As **gate** (value now) | As **charge** (trajectory crossing) |
|---|---|---|
| **Relationships** (`trust/affection/respect/fear`) | a `conditions` check (`trust ≥ X` unlocks an arm) | sign flip / betrayal-cutoff crossing → elevate (richest source) |
| **Identity** (6 axes) | gates identity-locked options | axis crossing midpoint → character-defining turn; **expression choices plant the flags that move it** |
| **Scores** (story ints) | `suspicion ≥ 70` gates an arm | the meter *crossing* 70 → charge |
| **Flags / Tags** | `conditions` gate on a flag/tag | accumulated flags discharged at a gated choice |
| **Delayed consequences** | — | the most explicit charge already in-engine; a landing scene is a convergence node |
| **Skills** (genre-specific) | `statCheck` access + `showWhenLocked` arms + outcome odds | **competence trajectory**: a *previously-failed* wall now passable = high-charge payoff (see §Competence loop) |
| **Attributes** (charm/wit/courage/empathy/resolve/resourcefulness) | back skills via `attributeWeights`; drive checks | slow growth = deep competence/character arc; often co-moves with identity (dedupe!) |
| **Inventory** | keys / `statModifiers` gate or modulate a check | a Chekhov item tied to a thread: its *use* is a payoff |

### The load-bearing distinction (restated)

- **Value → gate.** Determines *access* to branch arms and the *outcome spread*
  (victory/partial/defeat) *within* a heavy tier. The per-player **diversity
  engine** — why encounters (stat-rich) are diversity hotspots.
- **Trajectory crossing → charge.** *Elevates* a moment to major and *gates the
  heavy band* (Rule 2). Answers *"has this been earned?"*

A single skill **check** is still not a turn. But the **overcoming of a wall you
once failed** *is* a turn — it is the payoff of a competence arc. Snapshot:
diversity. Trajectory: meaning. Both, always.

### Awareness of *evolution*, not just snapshots

Tier decisions read **planned trajectories** (`RelationshipTrajectoryTarget`,
`IdentityAxisTarget`, `ArcMilestone.phase`, authored score/skill arcs) — *where
the design says state is heading*. Charge comes from a trajectory **crossing a
threshold near a scene**, never an absolute value (trust at 5 is charged only if
it is *falling through* a cutoff here). Gates read **expected** levels at that
point in the season (a difficulty-vs-progression curve), so odds are tuned to what
the player plausibly has — not flat.

### The competence loop (skill/attribute charge, done right)

Your four constraints — *don't enter a fight you have no shot at · checks aren't
easy · fail-forward · let people fail, grow on side content, then overcome* — are
one mechanism: a **lock → fail-forward → grow → overcome** arc wired into the
Convergence Ledger.

**1. The roadblock is a plant.** A heavy-tier moment gated on skill/attribute
level *N* is a ledger edge (`source:'skill'`), "locked" relative to the player's
**expected** level on first contact. Its anchor is an authored
`ArcMilestone(phase:'test')` or a competence thread — *no anchorless skill walls*
(same story-first rule as everything else).

**2. Winnability — the no-dead-wall constraint (your "no shot" point).** At plan
time, compare the gate level *N* against the **expected skill trajectory**:

| Case | Expected level vs gate | Verdict |
|---|---|---|
| **Winnable now** | ≥ N | a fair check — *not easy*, but passable with tension |
| **Winnable later** | < N now, but a growth path reaches N before a *required* payoff | a **deliberate roadblock** — legal *only if* a charging path + a return opportunity both exist |
| **Never winnable** | no growth path reaches N before it is required | **ILLEGAL dead wall** — validator rejects: lower the gate, add a growth path, or make it fail-forward-only |

**3. Fail-forward is a branch, not a dead end (your "checks aren't easy" point).**
A failed check must `leadsTo` a *continuing, different* path (the encounter
outcome tree: `defeat`/`partial`/`escape` storylets). Crucially, **failure carries
consequence tier**: a failure that meaningfully diverges the story is a
`branchlet`/`branch`, *not* a `callback`. An encounter's branch-ness is the
**spread between its victory and failure paths** — high divergence → branch; "fail
just retries" → not heavy at all. This is how "we *want* people to fail" is
honored: failure is productive divergence, never punishment-and-reload.

**4. Side-content growth charges the return (your "grow then overcome" point).** A
side quest that raises skill *X* is a **plant toward a specific later roadblock's
payoff** (overcoming it). Side content is therefore *load-bearing*, and the
inverse flag exists: a skill gain that unlocks **no** downstream wall is
**"dangling growth"** (uncharged texture) — the same defect as a hollow branch,
caught by the same validator family. And **overcoming a wall you previously
failed** is a *high-charge* payoff (the player carries the memory of the failure,
the grind, and the return) → strongly elevated, often a `branch`.

**5. Difficulty curve.** Encounters are tuned to *expected* skill at that spine
position: **most** checks passable-with-tension, **some** deliberate roadblocks
(fail-forward now / overcome later), **none** impossible-when-required. The curve
is read from the planned skill/attribute trajectory, not assumed flat.

This keeps skills/attributes story-first: a wall matters because it is an authored
*test* milestone whose later *overcome* is a turning-point — the numbers measure
and gate it, the arc gives it meaning.

---

## Part 6 — Making the systems work together: the Convergence Ledger

Today, "this moment matters" is represented **five different ways** by five
agents that can drift apart:

`setupPayoffEdges` (SceneSpine) · `ThreadLedger.plants/payoffs` (ThreadPlanner) ·
`RelationshipTrajectoryTarget` (CharacterArcTracker) · `IdentityAxisTarget` /
`ArcMilestone` (CharacterArcTracker) · `DelayedConsequence` queue (ChoiceAuthor).

These are all the **same underlying thing**: charge flowing from a plant to a
payoff. The fix that stops them fighting is to **project them onto one artifact**:

```
ConvergenceLedger
  nodes: sceneId[]
  edges: {
    from: sceneId            // plant
    to:   sceneId            // payoff / detonation
    source: 'thread'|'relationship'|'identity'|'score'|'flag'|'item'|'skill'|'attribute'|'delayed'|'setupPayoff'
    gateLevel?: number       // for skill/attribute roadblocks: the level N required
    overcomesPriorFailure?: boolean  // payoff of a wall the player previously failed → high charge
    magnitude: number        // contribution to charge(to)
    anchorId: string         // the authored object that justifies this edge
    materialized?: boolean    // filled at episode time (Part 9)
  }
```

- Each agent **contributes edges** (it does not compute its own private notion of
  importance).
- `computeChargeMap` aggregates inbound edges → `charge(scene)`; the allocator,
  ThreadPlanner, and BranchManager all **read the same map**.
- Every edge carries an **`anchorId`** — the authored narrative object behind it.
  This is the seam that keeps it story-first (Part 7): no anchorless charge.

One ledger, many contributors, single read path. That is "systems compose, not
collide" made concrete.

---

## Part 7 — Story-first guardrails (so stats never take the wheel)

These are invariants the implementation must hold, not aspirations:

1. **Intent drives, stats confirm.** Charge has two components:
   `narrativeIntentCharge` (threads, milestones, trajectory targets — each with an
   `anchorId`) is **primary**; `statTrajectoryCharge` (a meter crossing) is a
   **bounded confirming multiplier**, capped so it can *never manufacture a branch
   on its own*. A score hitting 70 with no narrative object behind it does **not**
   create a major moment.
2. **No anchorless heavy tier.** Rule 2 requires `≥1` inbound edge with an
   `anchorId`. A branch must name the authored thread/arc/twist it serves.
3. **Honest under-allocation.** If story logic produces fewer earned majors than
   the budget reserves, the budget goes **unspent** — the allocator never
   fabricates a hollow fork to "hit the number." The season % is a guideline, not
   a quota.
4. **Stats serve the turn, not vice versa.** Consequences are chosen because the
   scene's dramatic question demands them; the budget then *checks* magnitude is
   consistent. The allocator never invents drama to spend a slot.
5. **Quantitative coherence is a floor, not a ceiling.** Validators enforce
   *consistency* (trajectories monotonic toward targets, thresholds reachable, no
   contradictions) and *coverage* (every heavy tier charged) — they do **not**
   optimize for more branches or exact %.
6. **Fiction-first is inviolate.** Charge, tiers, thresholds, scores, skills — all
   generator-internal. The branch *reads* as a dramatic turn; the player never
   sees a meter. (`STORY_QUALITY_CONTRACT.md`.)

---

## Part 8 — Worked 8-episode season (everything together)

Spine (deterministic, `sevenPointDistribution`): E1 hook · E2 plotTurn1 ·
E3 pinch1 · E4 rising · E5 midpoint · E6 pinch2 · E7 climax · E8 resolution.
Shape: 5 standard scenes/ep (40) + 8 encounters (3 branch-points), weight 64.

**Authored spine for the example:** (a) an ally, Vale, whose
`RelationshipTrajectoryTarget` runs trust `+40 → −15` ("loyal → betrayer") across
E1–E6, carried by a major `promise` thread `vale-breaking`; (b) a protagonist
`honest_deceptive` axis trending `+`; (c) a `suspicion` score rising toward a 70
cutoff; **(d) a competence arc** — an `infiltration` skill wall (gate level *N*)
the player is *expected to fail* at E3 (`ArcMilestone phase:'test'`), a side
strand in E4 that grows `infiltration`, and an *overcome* at E6
(`phase:'turning_point'`, `overcomesPriorFailure: true`).

| Ep | Posture | Charge carriers active | Capability gates | Tier outcomes |
|----|---------|------------------------|------------------|---------------|
| E1 hook | convergent | plant `promise:vale-breaking`; expression choices set `honest_deceptive` flags | — | expression→callback ×3, relationship→callback, strategic→tint |
| E2 plotTurn1 | open-field | `setsUp`→E5; trust −12 (40→28) | charm `statCheck` | **1 dilemma branch** (commit-to-goal, charged by setsUp + thread plant); expression→tint, callback |
| E3 pinch1 | open-field | conceal informant (trust −15→~13); `suspicion +20`; **plant `infiltration` wall (test, expected fail)** | `infiltration` gate *fails* → **fail-forward** to a costlier arm | **1 strategic branchlet** (the *failure path* itself diverges); expression×2, relationship→tint |
| E4 rising | open-field | delayed consequence from E2 lands; identity axis crosses midpoint; **side strand grows `infiltration` → charges E6** | inventory key gates arm | **1 relationship branchlet** (identity payoff); side-growth scene; expression×2, callback |
| E5 midpoint | convergent | **`promise:vale-breaking` pays off; trust crosses betrayal cutoff** in the encounter | resolve `statCheck` shapes victory/partial/defeat | **encounter → branch** (Vale flips; charge maxed, branch *legal*); non-enc capped → callback/tint |
| E6 pinch2 | open-field short | `suspicion` crosses 70; **`infiltration` wall OVERCOME (`overcomesPriorFailure`) → high charge** | the *same* gate, now passable | **encounter → branch** (the overcome detonates; branch-point); 1 dilemma branchlet reconverging into climax |
| E7 climax | convergent | all threads converge | full stat spread decides ending arm | branch-point **encounter → branch** (the decisive one); non-enc → callback ×3, expression ×2 |
| E8 resolution | convergent | everything acknowledged | — | callback ×4, expression ×1 |

**Resulting weighted mix (/64):** callback 24 (37.5%) · tint 12 (18.8%) ·
branchlet 18 = 15 enc + 3 scene (28.1%) · branch 10 = 9 enc + 1 scene (15.6%).

**Reading it:**
- Every non-encounter heavy tier (E2 branch, E3/E4/E6 branchlets) is **charged by
  an authored object** — none are hollow. Strip the upstream Vale beats and E5
  *demotes* from branch to branchlet (Rule 2 refuses an unearned betrayal).
- **Two kinds of stat involvement, both legal.** At E3 the `infiltration` check
  *fails forward* — its failure *is* the branchlet (productive divergence, not
  reload). At E6 the *overcome* of that same wall is a high-charge **payoff** that
  helps make the encounter a branch. The E4 side-growth is *load-bearing* — it
  charges E6; with no downstream wall it would be flagged "dangling growth."
- **Snapshot vs trajectory in one episode:** at E6 the skill *value* gates which
  arm opens (diversity), while the skill *trajectory* (failed→grew→passed) supplies
  charge (meaning). Same dimension, both lanes.
- The no-dead-wall check passed because E4 provides a growth path reaching *N*
  before E6 requires it. Remove E4's side strand and E6's wall becomes an
  **illegal dead wall** (unwinnable when required) → validator rejects.
- The honest heavy-tier total (~44%) is *spine-derived*; the old fixed 25% target
  was the mis-calibration. Each population is on its own target.

---

## Part 9 — Validators & the two-pass (plan-time intent → episode-time materialization)

**Plan time (intent-based).** Charge is estimated from authored intent (thread
priorities, trajectory targets, edge in-degree, planned score arcs) → sets the
tier band. New/extended validators:

- `SeasonBudgetValidator` (extend): per-population mix vs target; spine-derived
  heavy band; **charge-coverage** — every `branch`/`branchlet` has ≥1 inbound
  edge with an `anchorId`; every major `promise` thread detonates at a heavy tier
  (does not fizzle into tint).
- `ConvergenceLedgerValidator` (new): edges point forward in time; no anchorless
  charge above the stat cap; trajectories monotonic toward their targets;
  thresholds reachable given planned deltas.
- `CompetenceReachabilityValidator` (new — the no-dead-wall guard): for every
  skill/attribute-gated heavy moment, the expected skill trajectory must reach the
  `gateLevel` **before** any *required* payoff that depends on passing it. Three
  outcomes per wall: winnable-now (ok), winnable-later (ok *iff* a growth path +
  return opportunity both exist), never-winnable (**error** — lower gate / add
  growth / make fail-forward-only). Also flags **dangling growth** (a skill gain
  that unlocks no downstream wall) and **fail-forward gaps** (a failed check whose
  arm `leadsTo` nothing — every failure must continue).

**Episode time (materialization).** When `ChoiceAuthor` writes the actual
`Consequence[]` (flag/score/relationship/identity deltas), confirm the charge
*materialized*:

- `ChargeMaterializationValidator` (new, in the retry loop): for each ledger edge,
  the promised plant was really authored and really moves the dimension toward its
  threshold. Set `edge.materialized`. A `branch` whose charge never materializes is
  flagged **"hollow branch"** and sent back through the repair pipeline.
- Ties into the existing **five-factor test** (major choice affects ≥3 of
  Outcome/Process/Information/Relationship/Identity): a high-charge discharge
  naturally satisfies it — use it as the materialization checklist.

---

## Part 10 — Implementation phases

All behind flags; default-off; diff against current allocator on real plans
before flipping. Respect the monolith ratchet (extract, don't grow files).

| Phase | Deliverable | Flag | Risk |
|---|---|---|---|
| **0 (done)** | `tierFloor` all-encounter floor + regression test | — | shipped |
| **1** | `proposeTier(unit, role)` — Layers A–C (positional), episode `structuralRole` threaded into allocator; pure refactor, same outputs within tolerance | `CONSEQUENCE_POSITIONAL=1` | low — diffable |
| **2** | Two-population budget (Layer D); scene-only target; spine-derived heavy band; validator split | `CONSEQUENCE_TWO_POP=1` | medium — re-targets % |
| **3** | `computeChargeMap` over `setupPayoffEdges` + `ThreadLedger`; Rule 1 (elevate) + Rule 2 (hollow-branch ban) | `CONSEQUENCE_CHARGE=1` | medium |
| **4** | `ConvergenceLedger` artifact; agents contribute edges; single read path; `ConvergenceLedgerValidator` | `CONVERGENCE_LEDGER=1` | high — touches multiple agents |
| **5** | State-trajectory charge (relationship/identity/score crossings) with the stat cap; capability-gate awareness in encounter outcome spread | `CHARGE_STATS=1` | medium |
| **5b** | **Competence loop**: skill/attribute charge (roadblock→fail-forward→grow→overcome); `CompetenceReachabilityValidator` (no dead wall / dangling growth / fail-forward gaps); expected-skill curve | `CHARGE_COMPETENCE=1` | medium-high |
| **6** | `ChargeMaterializationValidator` in the episode retry loop; hollow-branch repair | `GATE_CHARGE_MATERIALIZATION=1` | medium |

**Touch points:**
`src/ai-agents/pipeline/seasonBudgetAllocator.ts` (proposeTier, computeChargeMap,
two-population split) · `src/ai-agents/validators/SeasonBudgetValidator.ts` +
three new validators · `src/types/scenePlan.ts` (scene-only targets, charge fields)
· `src/types/convergenceLedger.ts` (new) · `CharacterArcTracker` / `ThreadPlanner`
/ `ChoiceAuthor` (contribute ledger edges) · `EncounterArchitect` (capability-gate
outcome spread, fail-forward arms) · an **expected-skill-curve** helper (planned
skill/attribute level by spine position, for winnability + difficulty).

**Testing:** extend `seasonBudgetAllocator.test.ts` (charge map, hollow-branch
ban, two-population mix); golden-diff the worked 8-ep plan; property test that no
heavy tier lacks an anchored edge; materialization test on a real generated
season's `ThreadLedger`.

---

## Part 11 — Risks & open questions

1. **τ auto-solve stability** — auto-tuning `τ_major`/`τ_charge` must be
   deterministic and monotonic (no oscillation across runs). Likely a single
   closed-form solve over the sorted magnitude/charge distribution, not iteration.
2. **Charge double-counting** — a thread payoff that *also* moves a relationship
   that *also* crosses an identity axis is one dramatic event, not three. Edges
   must dedupe by dramatic event (`anchorId` clustering), or charge inflates.
3. **Plan-time vs episode-time drift** — intent-based charge can over-promise;
   the materialization validator is the backstop, but repeated hollow-branch
   repairs could thrash the retry loop. Cap repairs; demote-on-fail rather than
   loop.
4. **Stat cap calibration** — how much can `statTrajectoryCharge` add before it
   risks taking the wheel? Start conservative (e.g. ≤30% of the elevation needed)
   and tune against real seasons.
5. **Short seasons / encounter-light treatments** — the spine-derived heavy band
   must degrade gracefully when there are 0–1 encounters (texture carries more).
6. **Does the player feel it?** The ultimate validation is playtest, not a
   validator: do charged branches *read* as earned turns? Keep a qualitative
   review loop alongside the quantitative gates.
7. **Expected-skill estimation** — the no-dead-wall check and difficulty curve
   depend on predicting the player's skill/attribute level at a spine position.
   Players vary (side content is optional). Estimate a **band** (min/expected/max
   given reachable growth), gate the *required* payoff against the achievable
   *max*, and tune challenge to the *expected* — never assume the median player.
8. **Failure that punishes vs. diverges** — fail-forward must lead somewhere
   *worse-but-alive and different*, not somewhere strictly punishing or a soft
   reload. Calibrating "a failure worth having" is a craft judgment the validator
   can only partly enforce (it checks the arm continues and diverges; playtest
   judges whether it *feels* fair).

---

## TL;DR

- **Fixed** the allocator/validator disagreement (Part 0).
- Replace slot-machine tiering with **two axes**: *positional* (where divergence
  has room — Layers A–D, incl. the two-population calibration fix) and *dramatic
  charge* (what accumulated state detonates here — Layer E).
- **Rule 2 (no charge, no branch)** turns small expression/tint beats into
  *ammunition assigned to specific detonations* — big moments are only legal where
  the small beats paid for them.
- Every state system has a **value/trajectory duality**: the *snapshot value* is
  a **gate** (access + odds + diversity within a tier); the *trajectory crossing a
  threshold* is **charge** (earns a major). This applies to **all** of them —
  including **skills and attributes**, whose *competence arc*
  (roadblock → fail-forward → grow on side content → overcome) is a real dramatic
  payoff, not just a gate. Read **trajectories**, not snapshots.
- The **competence loop** is enforced: no unwinnable-when-required dead walls,
  failure always fails *forward* (and a divergent failure can itself be a
  branchlet/branch), and side-content growth must charge a downstream wall (else
  "dangling growth").
- One **Convergence Ledger** unifies the five existing "this matters"
  representations so systems compose instead of fight.
- **Story-first guardrails** keep stats as confirming evidence with an anchor —
  intent drives, the budget is a guideline, fiction-first is inviolate.
