---
name: twist-and-thread-craft
description: >-
  Use this skill when authoring or debugging twists, narrative threads, foreshadow->reveal
  timing, path-aware payoffs, or branch-reconvergence residue — i.e. work touching the
  TwistArchitect, ThreadPlanner, BranchManager, or SequenceDirector agents, the
  TwistQualityValidator / SetupPayoffValidator, or the TwistPlan / ThreadLedger / NarrativeThread
  types.
---

# Twist and Thread Craft

The craft contract the generation pipeline authors against for surprise, setup/payoff, and branch
residue. These are the rules the TwistArchitect / ThreadPlanner / BranchManager / SequenceDirector
prompts enforce and the `TwistQualityValidator` / `SetupPayoffValidator` protect — change the rule
here and the prompt and validator together, never one in isolation. This skill owns twists, threads,
sequencing, and reconvergence *residue*; the structural branch-and-bottleneck rules live in
`story-structure-rules`.

**Why these rules exist:** branching fiction rots in two predictable ways. Either it plants ideas it
never pays off (Chekhov's gun — the locked drawer that never opens), or it pays off things it never
planted (deus ex machina — the rescue nobody set up). A twist that arrives with no foreshadow is a
"gotcha" that feels like the author cheated; a twist whose foreshadow lives in the same beat as the
reveal is a gotcha wearing a disguise. The agents below schedule surprise so it lands as
*surprising-but-inevitable*, and the validators measure that scheduling against the actually-generated
beats. Threads and twists are the same machinery viewed at two scales: a twist is a high-priority
`reveal` thread with a foreshadow plant.

## Twist construction (`TwistArchitect`)

Each episode schedules ONE memorable twist via a `TwistPlan`. The agent reads the StoryArchitect
`EpisodeBlueprint` (and optionally the `SeasonBible` / `ThreadLedger`) and decides which scene/beat
hosts the twist, which earlier scene/beat plants the foreshadow, and emits `directives` consumed by
SceneWriter via `twistDirectives`. The full output type:

```typescript
export type TwistKind = 'reversal' | 'revelation' | 'betrayal' | 'reframe';

export interface TwistPlan {
  episodeId: string;
  headline: string;          // "The mentor is the informant"
  kind: TwistKind;
  twistSceneId: string;      // scene + beat where the twist LANDS
  twistBeatId: string;
  foreshadowSceneId: string; // scene + beat where foreshadow is PLANTED (must precede)
  foreshadowBeatId: string;
  rationale: string;         // author note on *why* it is surprising-but-inevitable
  threadId?: string;         // reuse an existing NarrativeThread reveal instead of inventing one
  directives: Array<{
    sceneId: string;
    beatId: string;
    beatRole: 'foreshadow' | 'misdirect' | 'reveal' | 'aftermath';
    twistKind: TwistKind;
    hint: string;            // instruction passed to SceneWriter for that beat
  }>;
}
```

The four `TwistKind` values are exact:

| Kind | What changes | Example |
| --- | --- | --- |
| **reversal** | An expected outcome flips | the trusted guard betrays |
| **revelation** | A new fact changes the meaning of prior events | a letter names the informant |
| **betrayal** | A trusted character acts against the protagonist | the mentor turns |
| **reframe** | The *interpretation* of prior events shifts (identity, motive, timeline) with **no new facts** | the rescue was a setup |

The distinction between **revelation** and **reframe** is load-bearing: a revelation adds a fact the
player did not have ("here is the letter"); a reframe re-colours facts the player already had ("the
rescue you cheered was the trap closing"). Reframes are cheaper to plant — the evidence is already on
the page — but harder to make land, because the surprise has to come from *meaning* shifting, not
information arriving.

Rules the prompt enforces:
- **Surprising-but-inevitable.** Plant foreshadow at least ONE scene before the twist beat. No
  "gotcha" twists — the player must be able to look back and see the planted evidence. This is the
  twist-scale instance of `CORE_DRAMATIC_STRUCTURE_RULES` item 6, *No Unearned Payoffs*: "Every
  reveal, reversal, escalation, rescue, betrayal, power shift, and climactic solution needs setup
  proportional to its importance."
- **Twist must change stakes or player stance**, not just plot facts. A twist that rearranges plot
  furniture without moving what the player wants or fears is set dressing, not a turn.
- **Emit at least two directives**: one `foreshadow` beat (earlier) and one `reveal` beat (the
  landing). Optionally add `misdirect` (point attention away from the truth) or `aftermath` (let the
  changed stance breathe). Directive `beatRole` is one of `foreshadow | misdirect | reveal | aftermath`
  (TwistArchitect's own enum; note SceneWriter's `twistDirectives.beatRole` is the narrower
  `setup | twist | satisfaction`, and what the validator reads is the beat's `plotPointType`,
  `setup | payoff | twist | revelation` — three vocabularies for the same arc, do not confuse them).
- **Reuse existing reveal threads.** If a `NarrativeThread` already carries a revelation, set
  `threadId` instead of inventing a new one — this keeps the twist and the thread ledger reconciling
  to the same plant/payoff beats so both validators agree.
- Twists SHOULD reframe a season anchor (especially `StoryAnchors.stakes` or `.goal`). `find` and `take`
  episodes are the natural homes for the season's biggest twists, because the Story Circle discovery and
  cost beats are where new information changes what the player thinks the story is about.

### Example: a foreshadow -> reveal pairing

The `headline` is "The mentor is the informant". The foreshadow lands in scene-03; the reveal lands
three scenes later in scene-06:

```json
{
  "episodeId": "episode-1",
  "headline": "The mentor is the informant",
  "kind": "revelation",
  "twistSceneId": "scene-06",
  "twistBeatId": "beat-06-05",
  "foreshadowSceneId": "scene-03",
  "foreshadowBeatId": "beat-03-02",
  "rationale": "Player observed mentor flinch at the wrong name in scene-03; the letter in scene-06 names him.",
  "threadId": "mentor-loyalty",
  "directives": [
    { "sceneId": "scene-03", "beatId": "beat-03-02", "beatRole": "foreshadow", "twistKind": "revelation", "hint": "Have mentor react oddly to the agency name." },
    { "sceneId": "scene-06", "beatId": "beat-06-05", "beatRole": "reveal", "twistKind": "revelation", "hint": "Mentor's letter lays out the betrayal." }
  ]
}
```

Note the `threadId: "mentor-loyalty"` — the twist resolves an existing ledger thread rather than
spawning an orphan. The `rationale` is the inevitability proof: it names the exact earlier observation
(the flinch) that the reveal cashes in.

`TwistArchitect` **fails open**. On any LLM or JSON-parse error it returns `emptyPlan(episodeId)` (a
`TwistPlan` with empty scene/beat ids and `directives: []`) with `success: true` and the error
attached — the twist is *skipped*, not blocked, so generation continues. `normalizePlan` also coerces
any unknown `kind` to `'revelation'` and any unknown directive `twistKind` to the plan's `kind`, so a
slightly-malformed LLM response degrades rather than throws.

## Foreshadow -> reveal timing (`TwistQualityValidator`)

The validator flattens all generated beats into `(sceneIndex, beatIndex)` order, reads each beat's
`plotPointType` (`setup | payoff | twist | revelation`), and checks story-time ordering. It reports
against this metrics shape:

```typescript
export interface TwistQualityMetrics {
  twistPresent: boolean;            // any beat with plotPointType 'twist' | 'revelation'
  foreshadowPresent: boolean;       // any beat with plotPointType 'setup'
  foreshadowPrecedesReveal: boolean;// a setup precedes the earliest reveal in story time
  matchesPlan: boolean;             // generated beats honor the TwistPlan's scheduling
}
```

Severities are load-bearing:

| Condition | Severity |
| --- | --- |
| No `twist`/`revelation` beat in the episode | warning |
| Twist present but **no** `setup` foreshadow beat | **error** |
| All setup beats occur AFTER the twist | **error** |
| Foreshadow in the **same scene** as the reveal ("gotcha" risk) | warning |
| Generated scenes don't honor the planned twist scheduling (`twistPlan` supplied but `matchesPlan` false) | warning |

"Precedes" is judged by `(sceneIndex, beatIndex)` ordering. The validator finds the *earliest* reveal,
then looks for any `setup` strictly before it; a same-scene-earlier-beat counts as precedes (so
`foreshadowPrecedesReveal` is true) but still emits the same-scene warning. The fix for the same-scene
warning is to move the setup to an earlier *scene*, not just an earlier beat — same-scene foreshadow
reads as a gotcha because the player has no time to forget it before it pays off.

Scoring: `score = max(0, 100 - errors*25 - warnings*10)`, and `valid` is `errors === 0`. So a missing
foreshadow under a present twist (error) is far more costly than a missing twist entirely (warning) —
the validator would rather you ship no twist than ship an unearned one.

## Narrative-thread lifecycle (`ThreadPlanner` -> `ThreadLedger`)

A `NarrativeThread` is any seed/clue/promise/reveal spanning multiple beats. `ThreadPlanner` authors
the ledger from the blueprint; SceneWriter marks beats; `SetupPayoffValidator` reconciles. The exact
types (`src/types/narrativeThread.ts`):

```typescript
export type ThreadKind = 'seed' | 'clue' | 'promise' | 'reveal';
export type ThreadPriority = 'major' | 'minor';
export type ThreadStatus =
  | 'planned'    // declared; no plant or payoff attached yet
  | 'planted'    // planted in at least one beat
  | 'paid_off'   // has at least one payoff beat referencing it
  | 'dangling'   // planted but never paid off — structural violation
  | 'unplanted'; // paid off without any plant — structural violation

export interface ThreadPlant  { sceneId: string; beatId: string; note?: string; }
export interface ThreadPayoff { sceneId: string; beatId: string; note?: string; reframe?: string; }

export interface NarrativeThread {
  id: string;                          // stable slug
  kind: ThreadKind;
  priority: ThreadPriority;            // drives validator severity (see below)
  label: string;
  description: string;
  introducedInEpisode?: number;        // omit => season-wide
  expectedPaidOffByEpisode?: number;   // enforced by SetupPayoffValidator
  plants: ThreadPlant[];
  payoffs: ThreadPayoff[];
  status: ThreadStatus;                // starts 'planned'; validators promote it
  tags?: string[];
}

export interface ThreadLedger {
  threads: NarrativeThread[];
  designNotes?: string;                // author note on how the threads interlock
}
```

`ThreadKind` is exact:

| Kind | Definition |
| --- | --- |
| **seed** | A small concrete detail the audience can notice later (locked drawer) |
| **clue** | A specific evidence item that rewards attentive readers (missing tooth on the watch) |
| **promise** | A stakes-level commitment to the reader ("you WILL face your mother") |
| **reveal** | A revelation that reframes earlier events (the mentor was the informant) |

The kinds form a difficulty/visibility gradient: a **seed** is plantable in passing and rewards only
the attentive; a **promise** is a loud commitment the reader is *meant* to remember and will feel
cheated if you drop. That gradient is why `priority` matters more than `kind` for enforcement — a
major promise dangling is an error; a minor seed dangling is a warning (the reader probably never
noticed it).

Rules the prompt enforces:
- **Every thread needs a plant AND a payoff.** If you can't commit to paying it off within the
  episode (or by `expectedPaidOffByEpisode` for multi-episode runs), drop it. A thread you can't pay
  off is debt, not setup.
- **No orphan promises** (planted, never paid off — Chekhov's-gun violation) and **no unplanted
  reveals** (paid off, never planted — deus-ex-machina violation).
- **Thread cap: 3–7 threads per episode, at most one major thread per scene.** The cap exists because
  past ~7 the reader can't track them and the payoffs blur; one-major-per-scene keeps each scene's
  spine legible.
- Threads must map onto concrete blueprint scene + beat ids in `plants` and `payoffs`.
- **Information has ownership.** Major clues/secrets/threats/questions declare tension mode via
  tags: `mystery`, `dramatic-irony`, `secret`, `threat`, `relationship-secret`, `theme-question`,
  `payoff-required`. This is `CORE_DRAMATIC_STRUCTURE_RULES` item 7: "Every major clue, secret,
  threat, and open question must declare who knows it and when it pays off... The player must know
  enough to roleplay intent" — i.e. enough information to make major choices *as the character*, not
  blindly.
- Every planted promise SHOULD map to a season anchor so payoff pressure flows toward the Climax.

### Example: a thread ledger entry

A minor `seed` planted early and forced open at the twist beat — note it shares the `scene-06` payoff
neighborhood with the twist above, and its `id` matches a tag back to the locket motif:

```json
{
  "threads": [
    {
      "id": "locked-drawer",
      "kind": "seed",
      "priority": "minor",
      "label": "Locked drawer in mentor's desk",
      "description": "Player notices a locked drawer in scene-02; later it contains the key evidence.",
      "introducedInEpisode": 1,
      "expectedPaidOffByEpisode": 1,
      "plants":  [{ "sceneId": "scene-02", "beatId": "beat-02-03", "note": "Visible in dialogue beat" }],
      "payoffs": [{ "sceneId": "scene-06", "beatId": "beat-06-04", "note": "Player forces it open; finds letter" }],
      "status": "planned",
      "tags": ["mystery", "locket"]
    }
  ],
  "designNotes": "Short author note about how these threads interlock."
}
```

The lifecycle, full:

| Status | Meaning |
| --- | --- |
| `planned` | Declared; no plant or payoff attached yet |
| `planted` | Planted in at least one beat |
| `paid_off` | Has at least one payoff beat referencing it |
| `dangling` | Planted but never paid off — **structural violation** |
| `unplanted` | Paid off without any plant — **structural violation** |

`status` always starts as `planned` (the prompt mandates it, and `normalizeLedger` defaults it).
Validators promote it based on actual generated content — do not author a non-`planned` status by
hand, it will be overwritten. SceneWriter marks beats with `plantedThreadIds` / `paidOffThreadIds`
(and the per-beat `plantsThreadId` / `paysOffThreadId` the validator actually reads); the validator
reconciles those *observed* plants/payoffs against the ledger's *authored* ones, unioning the two so a
plant SceneWriter emitted but the planner didn't pre-declare still counts.

`ThreadPlanner` **fails open**: on error it returns `{ threads: [] }` with `success: true` so the
pipeline proceeds. `normalizeLedger` backfills missing ids (`thread-${idx+1}`), defaults `kind` to
`'seed'`, `priority` to `'minor'`, and `status` to `'planned'`, and coerces `plants`/`payoffs`/`tags`
to arrays — so a sparse LLM response still yields a valid ledger.

## Setup/payoff enforcement (`SetupPayoffValidator`)

Verifies every plant has a payoff and vice versa, reconciling the authored ledger with the beats'
observed `plantsThreadId` / `paysOffThreadId`. Severity is keyed to `priority`:

| Violation | `major` thread | `minor` thread |
| --- | --- | --- |
| Paid off but never planted (deus ex machina) -> `unplanted` | **error** | warning |
| Planted but never paid off by `expectedPaidOffByEpisode` -> `dangling` | **error** | warning |

The dangling check only fires when the payoff is actually *due*: `dueThisEpisode` requires both
`currentEpisode` and `expectedPaidOffByEpisode` to be set and `currentEpisode >= expectedPaidOffByEpisode`.
A thread legitimately deferred to a later episode is `planted`, not `dangling` — multi-episode setup is
allowed, broken promises are not. A thread with neither plant nor payoff stays `planned` (not a
violation; it just never got used). The metrics returned:

```typescript
export interface SetupPayoffMetrics {
  totalThreads: number;
  planted: number;
  paidOff: number;
  dangling: number;
  unplanted: number;
}
```

Scoring: `score = max(0, 100 - errors*20 - warnings*8)`; `valid` is `errors === 0`. The returned
`threads` array carries each thread with its promoted `status` and the *unioned* plants/payoffs, so
downstream consumers see the reconciled truth, not just what the planner declared.

## Path-aware payoffs

**Payoffs are path-aware.** A branch-specific payoff must be planted on **that branch or in a
shared bottleneck before the branch**. Never pay off information the player could not have
encountered on that reachable path. This is the thread/twist counterpart to the structural
branch-and-bottleneck rules in `story-structure-rules` — the plant has to be on every reachable
route that can hit the payoff, which in practice means planting at the **last shared bottleneck**
before the branch fork. If only the stealth branch plants the clue but both stealth and combat
branches reconverge into a payoff that assumes it, the combat-path player hits an unplanted reveal —
a deus ex machina the `SetupPayoffValidator` cannot catch (it sees the plant exists *somewhere*) and
only path-aware authoring prevents. When in doubt, sink the plant down to the bottleneck.

## Sequence pacing (`SequenceDirector`)

`SequenceDirector` builds a per-scene `SceneVisualSequencePlan` and assigns each beat a
`sequenceIntent.beatRole` for the storyboard. The beat-role enum (`src/types/content.ts`) is exact:

```typescript
beatRole?: 'setup' | 'pressure' | 'escalation' | 'turn' | 'consequence' | 'handoff' | 'aftermath';
```

The narrative beat-role arc is `setup -> pressure -> escalation -> turn -> consequence/handoff ->
aftermath` (inferred by `inferBeatRole` when not authored: the first non-establishing beat is `setup`,
the last is `consequence` — or `handoff` if it's a choice point — the middle/dominant/climax beat is
`turn`, `rest`-tier beats default to `pressure` or `aftermath`). The scene-level `shotRhythm`
(`SHOT_RHYTHM`) runs `establishing -> relationship -> insert -> reaction -> confrontation -> reversal
-> outcome -> aftermath`.

**A twist's `reveal` beat should land on a `turn`** (high intensity / `dominant`), and the following
`aftermath` beat is where reconvergence residue and the twist's changed stance become visible — the
reveal is the blow, the aftermath is where the reader watches it sink in. SequenceDirector is
**deterministic post-processing**: it repairs/derives coverage (staging pattern, shot distance, camera
angle/side, visible character ids) rather than calling an LLM, prefers strong authored text over its
own inferences via `authoredTextOr` / `isStrongAuthoredText`, and only **warns** (does not abort) when
a scene's beats are under-covered or when it had to repair weak `relationshipBlocking` / `coverageReason`.

## Branch reconvergence carries residue (`BranchManager`)

`BranchManager` analyzes the concrete scene graph (it does NOT re-define the branch-and-bottleneck
framework — that's in the shared system prompt `BRANCH_AND_BOTTLENECK` / `story-structure-rules`; the
agent prompt explicitly says "do NOT repeat the framework definitions"). Its twist/thread-relevant job
is **residue**: when branches rejoin at a `ReconvergencePoint`, emotional reset is forbidden. This is
`CHOICE_PAYOFF_AND_RECONVERGENCE`'s Reconvergence Rule — "Reconvergence is allowed; emotional reset is
not" — and `CORE_DRAMATIC_STRUCTURE_RULES` item 8, *No Reset Units*.

The relevant output types:

```typescript
export interface StateChange {
  type: 'flag' | 'score' | 'tag' | 'relationship';
  name: string;
  change: string | number | boolean;
  sceneId: string;
  significance: 'minor' | 'moderate' | 'major';
}

export interface ReconvergencePoint {
  sceneId: string;
  incomingBranches: string[];
  stateReconciliation: StateReconciliation[];
  narrativeAcknowledgment: string;   // how the story acknowledges the differing paths
}

export interface ValidationIssue {
  severity: 'warning' | 'error';
  type: 'orphan_branch' | 'missing_reconvergence' | 'state_conflict' | 'unreachable_scene' | 'dead_end';
  description: string;
  affectedScenes: string[];
  suggestedFix?: string;
}
```

Each reconvergence must reconcile differing state and carry residue forward through one or more of:

- **tone** (emotional footing)
- **knowledge / information** (what the player learned on that branch)
- **relationship** (trust/affection/respect/fear shifts)
- **identity** (who the protagonist became)
- **callbacks** (NPCs noticing branch-specific events)

A branch that only changes routing and leaves no visible residue should be a tint/callback instead
(the Distinct Experience Rule: "A branch is strong when two players could compare notes and describe
meaningfully different versions of the same story moment"). `StateChange.significance` is
`minor | moderate | major`; `ValidationIssue.type` includes `orphan_branch`, `missing_reconvergence`,
`state_conflict`, `unreachable_scene`, `dead_end`. **Orphan state** (set but never read) is the
state-level analogue of a dangling thread — a design smell flagged here. Unlike the fail-open agents
above, BranchManager returns `{ success: false }` on error (it does not synthesize an empty analysis).

### Example: a reconvergence `setupTextVariants`

The structural plumbing for residue is conditional reconvergence text keyed off the flags/scores each
branch set. The bottleneck scene opens with the variant matching the route the player took:

```json
"setupTextVariants": [
  { "condition": "flag:chose_stealth", "text": "Having slipped past the guards, you arrive unseen — and still breathing easy." },
  { "condition": "flag:chose_combat",  "text": "Still catching your breath from the fight, you arrive bruised and counting the cost." }
]
```

Same scene, same plot position, two genuinely different emotional footings — that is residue made
visible on the page rather than buried in hidden state.

## See also
- `story-structure-rules` — owns the structural branch-and-bottleneck framework, bottleneck/branch
  zones, the distinct-experience rule, and stakes/consequence frameworks this skill builds on.
- `pipeline-validation` — the validator tiering and how `TwistQualityValidator` /
  `SetupPayoffValidator` errors vs warnings affect the run.
- `pipeline-agent-development` — extending `BaseAgent`, prompt/JSON-parse conventions, and the
  fail-open pattern these agents use.
- Claude twin: `.claude/skills/twist-and-thread-craft/SKILL.md` — the concise version of this skill;
  keep the two in sync when a rule/enum/cap changes (this `.cursor` copy is the richer superset).
- Source: `src/ai-agents/agents/TwistArchitect.ts`, `src/ai-agents/agents/ThreadPlanner.ts`,
  `src/ai-agents/agents/BranchManager.ts`, `src/ai-agents/agents/SequenceDirector.ts`.
- Validators: `src/ai-agents/validators/TwistQualityValidator.ts`,
  `src/ai-agents/validators/SetupPayoffValidator.ts`.
- Types: `src/types/narrativeThread.ts` (`ThreadKind` / `ThreadStatus` / `ThreadLedger`),
  `TwistPlan` / `TwistKind` in `TwistArchitect.ts`, `Beat.sequenceIntent.beatRole` in
  `src/types/content.ts`.
- Shared prompt: `src/ai-agents/prompts/storytellingPrinciples.ts`
  (`BRANCH_AND_BOTTLENECK`, `CHOICE_PAYOFF_AND_RECONVERGENCE`, `CORE_DRAMATIC_STRUCTURE_RULES`
  items 6–8: No Unearned Payoffs, Information Has Ownership, No Reset Units).
