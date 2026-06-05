# Season Canon & Scene-First Planning

Two architectural systems landed during the May 29 – Jun 5 push that, together,
turn the story generator from "generate-and-hope" into a pipeline that **plans
forward-references up front** and **guarantees they're honored**. This doc
explains both, then traces a concrete example through them.

Both systems are behind default-off flags, so the existing pipeline is unchanged
unless opted in:
- Season Canon: default **on**, opt-out (`SEVEN_POINT_BLOCKING=0`, etc. per gate).
- Scene-first planning: default **off** (`SCENE_FIRST_PLANNING`, hard budget gate
  `GATE_SEASON_BUDGETS`).

---

## Season Canon

**The problem it solves:** LLM story generation drifts. The same fact — who knows
what, what color someone's eyes are, whether the bridge is still standing — gets
*re-derived independently* by every prompt that needs it, and each call guesses
slightly differently. Across a multi-episode season this compounds into
contradictions and dangling promises.

**The cure:** freeze facts into a deterministic, append-only record the moment an
episode passes validation ("sealing"), then make every downstream prompt **read**
canon instead of reinventing it. It's a five-phase system.

### The canon store (`seasonCanon.ts`)

The frozen "reality" of the season. Four fact categories, all keyed (not free
prose) so consistency checks are deterministic:

- **World facts** — `{id, statement, establishedEpisode}`
- **Knowledge** — who-knows-what-when (`characterId` knows `factId` as of episode N)
- **Character arc state** — sealed per-episode
- **Relationships** — dimensional values by episode

Core operations:

- `sealEpisode(N, deltas)` — appends episode N's established facts. **Append-only
  by construction**: a fact's `establishedEpisode` is fixed, existing facts never
  mutate, and re-sealing the same episode is *rejected*.
- `canonForPrompt(asOfEpisode)` — a read-only snapshot formatted as *"ESTABLISHED
  CANON — do not contradict,"* injected into SceneWriter / ChoiceAuthor.
- `knownAsOf(characterId, episode)` — the substrate for the **impossible-knowledge
  gate** (`canonConsistencyValidator.ts`): catches a character acting on something
  they couldn't know yet.

The store is pure data + pure transforms; persistence (`season-canon.json`) and
the LLM fact-extraction step are handled by the runner
(`seasonSealOrchestration.ts`, `knowledgeExtraction.ts`).

### Promises: plant → payoff (`callbackLedger.ts` + `spinePlantMap.ts`)

The Witcher-style delayed-consequence machinery, hardened into a contract:

- The **CallbackLedger** tracks "memorable moments." An author tags a notable
  choice with a `memorableMoment`; the pipeline harvests it into a `CallbackHook`.
  Before episode N+1 generates, unresolved hooks are injected into prompts. When a
  later scene emits a `TextVariant` with a matching `callbackHookId`, a payoff is
  recorded.
- **P2 added `payoffEpisode`** — instead of paying off against a vague *window*, a
  promise can name the *specific* episode it's due, enforced exactly when that
  episode runs (the "promise-due gate").
- **The SpinePlantMap** is the deterministic consumer of that target. The season
  spine (LLM, up front) declares for each thread *which episode plants it and
  which pays it off*; `applySpinePlantMap` pins those targets onto the ledger.
  Cleverly, it can derive the whole map from the season plan's existing
  `seasonFlags` (each carry-flag already declares `setInEpisode` /
  `checkedInEpisodes`) — **no LLM schema change needed**. Entries that don't match
  a ledger hook are reported as `unmatched` rather than silently dropped.
- **P5 added `abandoned` / `abandonReason`** — a promise whose path was never taken
  (or that the spine cut) can be explicitly retired. The completion gate treats
  *abandoned the same as paid*; the only failure is a promise left **silently
  open**.

### The season-completion gate

`validateSeasonCompletion` runs once the whole season has sealed: **every promise
must be paid or explicitly abandoned by season end.** Wired advisory at first,
with the plan being to flip it to blocking once multi-episode regens confirm it.

### Incremental seal/resume (P4)

A run can seal episodes one at a time with state snapshots and resume — so a long
season doesn't have to regenerate from scratch, and sealed facts persist across
runs.

**Net:** facts get established once and read forever; every setup is tracked to a
concrete payoff episode; and the season can't "complete" with a dropped thread.

---

## Scene-First Planning

**The inversion.** The pipeline *used to* plan the 7-point spine, assign each
episode one beat, then **invent scenes per-episode inside the generation loop** to
land that beat. Beats were the primary unit; scenes were derivative and
episode-local. The fatal limitation: **a scene could not be planned as "the payoff
of a scene two episodes earlier," because no season-wide scene list existed at plan
time.**

Scene-first planning flips the hierarchy.

### Episodes *and their scenes* are enumerated at the season level

A `SeasonScenePlan` lists every scene across the whole season up front, with
**cross-scene setup/payoff wiring** (`SetupPayoffEdge`, forward-only). The 7-point
structure stays a *meta*-concept: the season owns the `SevenPointStructure`, each
episode maps to **one** `structuralRole`, and each scene serves the arc-purpose its
episode carries. Beats (the actual prose units) are still generated later, in the
per-episode loop, to serve their now-pre-planned scene.

### Encounters are a *kind of scene*, not a parallel structure

A combat/social encounter is just a `PlannedScene` with `kind: 'encounter'`
carrying `PlannedSceneEncounter` detail (type, difficulty, relevant skills,
`isBranchPoint`, branch outcomes…). This is the quietly important unification:
quiet scenes and encounters live in **one ordered list**, so *anything that reasons
over scenes — pacing, the consequence/branch budget — sees encounters by
construction* rather than having to special-case a separate encounter list.

### The deterministic v1 builder (`seasonScenePlanBuilder.ts`)

v1 is **deterministic and path-agnostic** — it synthesizes the scene spine from
data the season plan *already carries* (`structuralRole`, `plannedEncounters`,
`synopsis`, `treatmentGuidance`, plus season-level `consequenceChains`,
`choiceMoments`, `informationLedger`). Because both authored-treatment and
from-scratch runs populate the season plan, there's **one downstream path** for
both. An LLM-authored scene plan can later replace/enrich the builder behind the
same flag. Scenes are clamped to 3–8 per episode. Each scene gets a
`SceneNarrativeRole` — `setup / development / turn / payoff / release` — and
`CHOICE_BEARING_ROLES` marks which carry a budgeted choice (release scenes are
breathers and don't).

### Season-level choice & consequence budgets layered on top

- **The "dramatic diet"** (`seasonChoicePlan.ts`): the choice mix
  (expression/relationship/strategic/dilemma ≈ **35/30/20/15**) is a **season**
  budget, not per-episode. Forcing all four types into one small episode is wrong —
  `expression 0% / strategic 0%` in a single episode is *fine* if the season
  balances. The SeasonPlanner identifies the choice *moments* across the whole arc;
  this module deterministically assigns each a `choiceType` using largest-remainder
  allocation over the **full** moment list, while still keeping each episode's local
  slice balanced. A "pays off later" moment is literally a Season Canon promise —
  `spineEntriesFromChoicePlan` feeds it straight into the SpinePlantMap. So the two
  systems join here: **a choice that matters later is a tracked promise.**
- **Consequence weighting**: scenes weigh 1, encounters weigh 3
  (`SCENE_BUDGET_WEIGHT` / `ENCOUNTER_BUDGET_WEIGHT`), with one non-expression role
  per encounter. The recalibrated consequence target is **50/25/17/8** across
  `callback / tint / branchlet / branch` — branch/branchlet rise because encounters
  legitimately branch. Invariants are enforced by tier: an `expression` unit ⇒
  `callback`; a `dilemma` unit ⇒ at least `branchlet`; **any encounter ⇒ at least
  `branchlet`, never `callback`**.
- **Validated *before* the plan finalizes**: `SeasonBudgetValidator` and
  `SceneSpineValidator` check the budget at season-planning time — so an episode is
  correct *by construction* rather than authored-then-repaired. Per-episode checks
  stay advisory.

---

## How the two connect

Scene-first planning produces a season-wide scene/choice list with forward
setup→payoff edges; Season Canon takes each "pays-off-later" edge, registers it as
a tracked promise with a concrete `payoffEpisode`, freezes the facts each sealed
episode establishes, and refuses to let the season complete with any promise left
dangling. **One plans the forward-references; the other guarantees they're
honored.**

---

## Concrete example: a choice planted in Episode 1, paid off in Episode 3

Take a 3-episode season. In Episode 1 the player can choose to spare or execute a
captured smuggler, *Renna*. The payoff is meant to land in Episode 3, where Renna
either returns as an ally (if spared) or her crew hunts the player (if executed).

### 1. Plan time — scene-first planning lays down the forward-reference

`SeasonPlannerAgent` enumerates the season's scenes and choice moments up front.
Among the `SeasonChoiceMoment`s it emits:

```jsonc
{
  "id": "moment-renna-fate",
  "episode": 1,
  "anchor": "Spare or execute the captured smuggler Renna",
  "payoff": { "payoffEpisode": 3 },   // not "immediate" → this is a promise
  "flag": "renna_spared"
}
```

- `seasonChoicePlan.ts` runs largest-remainder allocation over **all** moments in
  the season and assigns this one `choiceType: "dilemma"` (it's a moral fork). Per
  the tier invariant, a `dilemma` unit must reach at least `branchlet` — the
  consequence budget allocator records it accordingly.
- Because `payoff` is a later episode (not `"immediate"`),
  `spineEntriesFromChoicePlan` turns it into a `SpinePlantEntry`:

  ```jsonc
  { "flag": "renna_spared", "payoffEpisode": 3 }
  ```

- The scene that carries this choice is planted in Episode 1's scene list with a
  forward `SetupPayoffEdge` pointing at an Episode 3 `payoff`-role scene. Both
  scenes exist in the `SeasonScenePlan` **before any prose is generated** — the
  thing the old beat-first pipeline could not represent.
- `SeasonBudgetValidator` checks, *before the plan finalizes*, that the season's
  dilemma/branch budget still balances with this moment included.

### 2. Episode 1 generates and seals

- The episode authors the spare/execute scene. The chosen branch sets the flag
  `renna_spared = true|false`.
- The choice is tagged as a `memorableMoment`, harvested into a `CallbackHook` in
  the **CallbackLedger**.
- `applySpinePlantMap` pins the SpinePlantEntry onto that hook: its
  `payoffEpisode` is now `3` (authoritative; `payoffWindow` is derived from it).
  The promise is **open**, due in Episode 3.
- Episode 1 passes validation → `sealEpisode(1, deltas)` freezes the facts:

  ```jsonc
  {
    "worldFacts": [{ "id": "renna-fate", "statement": "Renna was spared at the docks" }],
    "knowledge":  [{ "characterId": "renna", "factId": "renna-fate", "summary": "Renna knows the player let her live" }],
    "relationships": [{ "a": "player", "b": "renna", "dimension": "trust", "value": 2 }]
  }
  ```

  These are now append-only — Episode 1 can never be re-sealed or its facts
  mutated.

### 3. Episode 2 generates — canon is read, not reinvented

- `canonForPrompt(2)` injects the *"ESTABLISHED CANON — do not contradict"*
  snapshot, so any scene that mentions Renna writes her as **alive and aware the
  player spared her** — no prompt re-guesses her fate.
- The Renna promise is **not yet due** (`payoffEpisode: 3`), so the promise-due
  gate stays quiet, but the unresolved hook is still surfaced to authors as a
  thread in flight.
- `knownAsOf("renna", 2)` means if a scene tried to have Renna act on something she
  couldn't know yet, `canonConsistencyValidator` would flag the impossible
  knowledge.

### 4. Episode 3 generates — the promise comes due

- The `payoff`-role scene planned back in step 1 is now authored. Because
  `renna_spared` was read from sealed canon, the branch is correct by construction:
  spared → Renna returns as an ally; executed → her crew hunts the player.
- When the scene emits a `TextVariant` carrying the matching `callbackHookId`, the
  pipeline **records a payoff** against the hook. The promise-due gate for Episode 3
  is satisfied.
- If the spared branch was never reachable on this path (say the player's route
  cut Renna out entirely), the hook is instead `abandon()`-ed with an
  `abandonReason` — explicitly retired, not silently dropped.

### 5. Season completion gate

After Episode 3 seals, `validateSeasonCompletion` sweeps every hook in the ledger.
The Renna promise is either **paid** (payoff recorded) or **abandoned** (explicit
reason). Either is acceptable. The only failure mode is a promise left **open** at
season end — exactly the dangling-thread bug this whole architecture exists to
prevent.

### What each system contributed

| Stage | Scene-first planning | Season Canon |
| --- | --- | --- |
| Plan | enumerated the Ep1 choice scene + Ep3 payoff scene with a forward edge; assigned `dilemma`/`branchlet` budget | turned the later payoff into a `SpinePlantEntry` |
| Ep1 | authored the budgeted scene | harvested the hook, pinned `payoffEpisode: 3`, sealed the facts |
| Ep2 | — | served frozen canon; held the open promise; guarded knowledge |
| Ep3 | authored the pre-planned payoff scene | recorded the payoff (or abandoned it) |
| End | — | completion gate: paid or abandoned, never dangling |
