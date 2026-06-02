# Season Canon — progressive, sealed, validated cross-episode generation

_Plan, 2026-06-02. Goal: plant choices in one episode that pay off in a specific
later episode, generate that later episode without regenerating prior ones, lock
facts into deterministic "reality" as we go, and validate each episode so it can
be SEALED and never reopened — keeping story/arcs/characters/relationships
coherent across the whole season._

## Principle: **the LLM proposes, the canon disposes**

Generation drifts when the same fact is re-derived by multiple calls, each
guessing. The cure is to **freeze facts into deterministic, read-only records as
soon as they're established**, and have every downstream call *read* them rather
than reinvent them. Each episode is generated against the frozen canon, validated,
then **sealed** — its facts become canon, and it is never regenerated.

### LLM vs deterministic split (the boundary)

| Deterministic (state, enforcement — never re-guessed) | LLM (creative — proposes content) |
|---|---|
| Promise ledger state machine (plant / pay / abandon) | The *content* of a promise, plant, and payoff (prose, dialogue) |
| Canon store of sealed facts (characters, world, relationships, knowledge, endings) | Candidate facts (a revealed motive, a relationship shift) — *before* sealing |
| State accumulation (flags, scores, relationships, knowledge-state) | Scene/choice prose, voice, the season *spine* outline |
| Payoff-episode targeting + due/dangling/seal validation | Conditional payoff content keyed on carried flags |
| Resume: load → generate → extract → validate → seal → persist | — |

**The handoff:** LLM output → *deterministic extraction* into canon/ledger/state
→ seal → served read-only to downstream prompts (marked "ESTABLISHED CANON — do
not contradict") + enforced by canon-consistency validators. A sealed fact can't
be overwritten because it is never regenerated (only read) and any contradiction
is caught.

---

## Data model

### 1. PromiseLedger (extend existing `CallbackLedger`)
A promise has an **explicit target payoff episode** — not a vague window — so it
can be enforced when that episode runs:
```
Promise {
  id
  kind: 'setup' | 'foreshadow' | 'relationship' | 'thread' | 'choice_consequence'
  summary                       // human/LLM-readable "what was promised"
  plantedEpisode, plantedScene
  payoffEpisode: number         // REQUIRED, specific (was: minEpisode..maxEpisode window)
  payoffEpisodeLatest?: number  // optional slack; defaults to payoffEpisode (no slack)
  conditionFlags: string[]      // path-gating; payoff is conditional on these
  tier: 'callback' | 'tint' | 'branchlet' | 'branch'
  status: 'open' | 'paid' | 'abandoned'
  paidEpisode?, paidScene?, abandonReason?
}
```
The existing `payoffWindow.{min,max}Episode` becomes derived from
`payoffEpisode`/`payoffEpisodeLatest`. Ledger already serializes — promote it to a
durable top-level artifact (`season-ledger.json`).

### 2. SeasonCanon (new, persisted, append-only / sealed)
The frozen reality. Append-only: facts are added when sealed, never mutated.
```
SeasonCanon {
  version
  characters[]:    { id, sealedProfile, voice, arcStateByEpisode[] }
  worldFacts[]:    { id, statement, establishedEpisode }
  relationships[]: { pair, dimension, valueByEpisode[] }   // monotonic-ish ledger
  knowledgeState[]:{ characterId, knows[], asOfEpisode }   // who-knows-what-when
  endingTargets[]: { id, stateDrivers, targetConditions }
}
```
Downstream prompts read this as authoritative input. Each entry carries
`establishedEpisode` so validation knows when a fact became canon.

### 3. EpisodeStateSnapshot (new, per episode)
The cumulative end-state, so episode N+k can start without N's prose:
```
EpisodeStateSnapshot(afterEpisode N) {
  flags: Record<string, boolean>          // path-aware: canonical + branch flags
  scores, relationships
  openPromises: id[]                      // due now or later
  knowledgeStateRef                       // pointer into canon
}
```

### 4. SeasonProgress (seal manifest)
`{ sealedEpisodes: number[], canonVersion, ledgerVersion }` — what's done and
immutable.

---

## Components & where they hook in

1. **Season spine (LLM, up front)** — `SeasonPlannerAgent` already outlines all
   episodes. **Extend it to emit an explicit plant→payoff map**: for each thread,
   which episode plants it and which episode pays it off. This is the *source of
   the `payoffEpisode` targets* and is cheap (outline, not prose).
2. **PromiseLedger (deterministic)** — `pipeline/callbackLedger.ts`: add explicit
   `payoffEpisode`, plant/pay/abandon transitions, durable load/save.
3. **Within-episode plant context (deterministic)** —
   `pipeline/callbackOrchestration.ts` + the content-generation loop: accumulate
   flags/promises planted *so far this episode* and feed them to later scenes.
4. **Canon store + freezer (deterministic)** — new
   `pipeline/seasonCanon.ts`: `sealEpisode()` extracts facts from a validated
   episode into the canon; `canonForPrompt()` serves read-only canon.
5. **Incremental episode runner** — `FullStoryPipeline.generateMultipleEpisodes`
   becomes: for each episode → load(canon, ledger, priorSnapshot) → generate(LLM)
   → extract deltas → validate → seal → persist. Resumable: generating episode N+k
   later just loads and runs; sealed episodes are skipped.
6. **Prompt assembly (LLM input)** — SceneWriter/ChoiceAuthor get: the canon
   ("ESTABLISHED — do not contradict"), the **promises due this episode** (must be
   paid), and the carried state. (SceneWriter already takes `unresolvedCallbacks`;
   extend with canon + due-this-episode emphasis.)
7. **State-scoped validators (deterministic enforcement)** — new validators in
   `validators/`, registered in `validatorRegistry.ts`, run in the per-episode
   gate.

---

## Validation gates — enforce the rules, fire only when due

Run per episode, before sealing. The anti-false-alarm rule: **validate against
generation state, not absolute presence.**

1. **Existing gates** — structural / final-contract / encounter-quality / etc.
2. **Promise-due (the key new gate):** every promise with `payoffEpisode === N`
   MUST be paid in episode N → else **block** and repair *episode N only*. This is
   the explicit-target enforcement.
3. **Dangling-payoff:** every payoff in N references a real open promise → else
   block. (Always safe — never a false alarm.)
4. **Plant-validity:** every promise newly planted in N has
   `N < payoffEpisode <= seasonLength` → else block (no vague/unreachable plants).
5. **Canon-consistency:** N contradicts no sealed canon — knowledge-state
   (impossible knowledge), character facts, relationship continuity → else block.
6. **On pass → SEAL:** freeze N's content + extract canon/ledger/state deltas +
   persist; mark N sealed. **On fail → repair N only** (it has the canon + ledger
   to fix itself); prior sealed episodes are never touched.
7. **Season-completion gate** (when all planned episodes sealed): every promise is
   `paid` or `abandoned`(with reason). A formality if 1–6 held — the safety net.

**Why you never hit the finale needing to regenerate ep1:** a promise is enforced
*at its `payoffEpisode`*, when that episode runs — so a shortfall is fixed *there*,
not retroactively. The spine assigns realistic `payoffEpisode`s up front, and
plant-validity rejects impossible promises at plant time. Sealed episodes are
immutable by construction.

**Branching:** promises/payoffs carry `conditionFlags`; payoffs are flag-conditional
content (the existing textVariant-gated-on-flag mechanism). Canon holds both
always-true and path-conditional facts. No path enumeration.

---

## Build order (each phase shippable + testable on its own)

**Phase 1 — Within-episode plant context** *(the current pain; do first)*
Accumulate flags/promises planted across scenes in one episode; feed to later
scenes so intra-episode callbacks pay off. Fixes single-episode `flagsReferenced`.
Deterministic core is unit-testable; yield confirmed by an Endsong regen.

**Phase 2 — Durable PromiseLedger + explicit `payoffEpisode` + promise validators**
Promote the ledger to a persisted artifact; add plant/pay/abandon + the due /
dangling / plant-validity validators (state-scoped). Unit-test the state machine
and that validators fire only when due.

**Phase 3 — SeasonCanon store + freezer + canon-consistency validator**
`sealEpisode()` extraction; read-only `canonForPrompt()`; the contradiction check
(start with knowledge-state, the recurring impossible-knowledge bug).

**Phase 4 — EpisodeStateSnapshot + incremental runner + seal/resume**
Load → generate → validate → seal → persist per episode; generate episode N+k
later from snapshots without regenerating N. Integration test: plant in ep1, seal;
generate ep3 later (no ep1 re-run); verify payoff + carried state.

**Phase 5 — Season spine emits plant→payoff episode map + season-completion gate**
Extend SeasonPlanner; wire the completion gate.

---

## Verification

- **Unit (deterministic):** ledger transitions; canon freeze/read immutability;
  state accumulation; each validator firing ONLY when due (e.g., an ep1→ep3 promise
  is "pending" not "violated" until ep3 exists).
- **Integration:** plant-in-ep1 → seal → generate-ep3-from-snapshots (assert ep1
  not regenerated; promise paid; carried flags honored; path-conditional payoff
  correct).
- **Regen:** Endsong single-episode after Phase 1 — `flagsReferenced` rises
  (within-episode callbacks pay off); after Phase 3 — `impossible_knowledge`
  warnings drop (canon-consistency catches/repairs).
- **Standing gates** after each phase: typecheck ×4, vitest, lint ≤431,
  reader-boundary, monolith ratchet.

## Implementation status (2026-06-02)

**Landed (deterministic cores, all gates green: typecheck ×4 · vitest · lint 0 · reader-boundary · monolith ratchet):**

- **Phase 1 — within-episode plant context.** `pipeline/episodePlantContext.ts`
  (`extractPlantsFromChoiceSet` / `plantsToUnresolvedCallbacks` /
  `mergeUnresolvedForScene`) wired into `FullStoryPipeline.runContentGeneration`:
  flags planted by earlier scenes are accumulated and merged into the
  `unresolvedCallbacks` fed to later scenes, so within-episode callbacks pay off.
  5 unit tests. Monolith +6 (baseline 21248). Yield (`flagsReferenced` rise) is
  Endsong-regen-verified.
- **Phase 2 — durable ledger + explicit `payoffEpisode` + promise validators.**
  `CallbackLedger` gains `payoffEpisode` (authoritative; derives the window),
  `setPayoffEpisode`, `dueAt`, `withExplicitTarget`, `has`. New pure
  `validators/promiseLedgerValidators.ts`: promise-due / dangling-payoff /
  plant-validity, each state-scoped (fires only when due — a later-targeted promise
  is *pending*, not violated). Registered in the manifest. 15 unit tests. The
  ledger already serializes → durable `season-ledger.json` ready for the runner.
- **Phase 3 — SeasonCanon store + freezer + canon-consistency validator.** New
  `pipeline/seasonCanon.ts`: append-only sealed facts (worldFacts / knowledge /
  arc state / relationships), `sealEpisode` (rejects re-seal — immutable),
  `canonForPrompt(asOf)`, `knownAsOf` / `knows` / `knowledgeEstablishedEpisode`,
  serialize/deserialize. New pure `validators/canonConsistencyValidator.ts`:
  knowledge-state / impossible-knowledge gate keyed on factId (a claim is
  impossible only when canon establishes the fact in a *later* episode). 11 unit
  tests. Registered in the manifest.

**Remaining (integration + LLM; need a multi-episode regen to verify end-to-end):**

- **Phase 4 — EpisodeStateSnapshot + incremental seal/resume runner.** Wire P2/P3
  into `generateMultipleEpisodes`: load(canon, ledger, prior snapshot) → generate →
  extract structured deltas (LLM → deterministic) → run the promise + canon gates →
  seal → persist; resume skips sealed episodes. This is where the validators move
  from "registered + unit-tested" to "fired in the per-episode gate", and where the
  LLM-extraction handoff (episode prose → KnowledgeClaim[] / EpisodeCanonDeltas) lives.
- **Phase 5 — SeasonPlanner emits plant→payoff episode map + season-completion gate.**
  Source of the explicit `payoffEpisode` targets; the final season formality gate.

## What exists vs. new
- **Exists:** `CallbackLedger` (hooks, windows, serialize), `SeasonPlannerAgent`
  (spine), resume/checkpoints, flag-conditional content, `unresolvedCallbacks` →
  SceneWriter.
- **New/extend:** explicit `payoffEpisode`; within-episode plant context;
  `SeasonCanon` store + freezer; `EpisodeStateSnapshot`; incremental seal/resume
  runner; the four state-scoped validators; SeasonPlanner plant→payoff map.
