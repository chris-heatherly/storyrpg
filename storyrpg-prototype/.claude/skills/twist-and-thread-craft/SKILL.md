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

## Twist construction (`TwistArchitect`)

Each episode schedules ONE memorable twist via a `TwistPlan`. The four `TwistKind` values are exact:

| Kind | What changes | Example |
| --- | --- | --- |
| **reversal** | An expected outcome flips | the trusted guard betrays |
| **revelation** | A new fact changes the meaning of prior events | a letter names the informant |
| **betrayal** | A trusted character acts against the protagonist | the mentor turns |
| **reframe** | The *interpretation* of prior events shifts (identity, motive, timeline) with **no new facts** | the rescue was a setup |

Rules the prompt enforces:
- **Surprising-but-inevitable.** Plant foreshadow at least ONE scene before the twist beat. No
  "gotcha" twists — the player must be able to look back and see the planted evidence.
- **Twist must change stakes or player stance**, not just plot facts.
- **Emit at least two directives**: one `foreshadow` beat (earlier) and one `reveal` beat (the
  landing). Optionally add `misdirect` or `aftermath`. Directive `beatRole` is one of
  `foreshadow | misdirect | reveal | aftermath` (TwistArchitect's own enum; note SceneWriter's
  `twistDirectives.beatRole` is the narrower `setup | twist | satisfaction`).
- **Reuse existing reveal threads.** If a `NarrativeThread` already carries a revelation, set
  `threadId` instead of inventing a new one.
- Twists SHOULD reframe a season anchor (especially Stakes or Goal). Midpoint / Plot Turn 2
  episodes are the natural homes for the season's biggest twists.

`TwistArchitect` fails open: on error it returns an empty plan so generation continues — the twist
is skipped, not blocked.

## Foreshadow -> reveal timing (`TwistQualityValidator`)

The validator reads generated beats by `plotPointType` (`setup | payoff | twist | revelation`) and
checks story-time order. Severities are load-bearing:

| Condition | Severity |
| --- | --- |
| No `twist`/`revelation` beat in the episode | warning |
| Twist present but **no** `setup` foreshadow beat | **error** |
| All setup beats occur AFTER the twist | **error** |
| Foreshadow in the **same scene** as the reveal ("gotcha" risk) | warning |
| Generated scenes don't honor the planned twist scheduling | warning |

"Precedes" is judged by `(sceneIndex, beatIndex)` ordering; same-scene-earlier-beat counts as
precedes but still warns. The fix for the same-scene warning is to move the setup to an earlier
*scene*.

## Narrative-thread lifecycle (`ThreadPlanner` -> `ThreadLedger`)

A `NarrativeThread` is any seed/clue/promise/reveal spanning multiple beats. `ThreadKind` is exact:

| Kind | Definition |
| --- | --- |
| **seed** | A small concrete detail the audience can notice later (locked drawer) |
| **clue** | A specific evidence item that rewards attentive readers (missing tooth on the watch) |
| **promise** | A stakes-level commitment to the reader ("you WILL face your mother") |
| **reveal** | A revelation that reframes earlier events (the mentor was the informant) |

Rules the prompt enforces:
- **Every thread needs a plant AND a payoff.** If you can't commit to paying it off within the
  episode (or by `expectedPaidOffByEpisode` for multi-episode runs), drop it.
- **No orphan promises** (planted, never paid off — Chekhov's-gun violation) and **no unplanted
  reveals** (paid off, never planted — deus-ex-machina violation).
- **Thread cap: 3–7 threads per episode, at most one major thread per scene.**
- Threads must map onto concrete blueprint scene + beat ids in `plants` and `payoffs`.
- **Information has ownership.** Major clues/secrets/threats/questions declare tension mode via
  tags: `mystery`, `dramatic-irony`, `secret`, `threat`, `relationship-secret`, `theme-question`,
  `payoff-required`. The player must know enough to roleplay intent before major choices.
- Every planted promise SHOULD map to a season anchor so payoff pressure flows toward the Climax.

`status` starts as `planned`; validators promote it. The full lifecycle:

| Status | Meaning |
| --- | --- |
| `planned` | Declared; no plant or payoff attached yet |
| `planted` | Planted in at least one beat |
| `paid_off` | Has at least one payoff beat referencing it |
| `dangling` | Planted but never paid off — **structural violation** |
| `unplanted` | Paid off without any plant — **structural violation** |

SceneWriter marks beats with `plantedThreadIds` / `paidOffThreadIds` (and per-beat
`plantsThreadId` / `paysOffThreadId`); the validator reconciles those against the ledger.

`ThreadPlanner` fails open: on error it returns an empty ledger so the pipeline proceeds.

## Setup/payoff enforcement (`SetupPayoffValidator`)

Verifies every plant has a payoff and vice versa. Severity is keyed to `priority`:

| Violation | `major` thread | `minor` thread |
| --- | --- | --- |
| Paid off but never planted (deus ex machina) -> `unplanted` | **error** | warning |
| Planted but never paid off by `expectedPaidOffByEpisode` -> `dangling` | **error** | warning |

## Path-aware payoffs

**Payoffs are path-aware.** A branch-specific payoff must be planted on **that branch or in a
shared bottleneck before the branch**. Never pay off information the player could not have
encountered on that reachable path. This is the thread/twist counterpart to the structural
branch-and-bottleneck rules in `story-structure-rules` — the plant has to be on every reachable
route that can hit the payoff, which in practice means planting at the last shared bottleneck.

## Sequence pacing (`SequenceDirector`)

`SequenceDirector` builds a per-scene `SceneVisualSequencePlan` and assigns each beat a
`sequenceIntent.beatRole` for the storyboard. The narrative beat-role arc is
`setup -> pressure -> escalation -> turn -> consequence/handoff -> aftermath` (inferred when not
authored). The scene-level `shotRhythm` runs
`establishing -> relationship -> insert -> reaction -> confrontation -> reversal -> outcome ->
aftermath`. A twist's `reveal` beat should land on a `turn` (high intensity / `dominant`), and the
following `aftermath` beat is where reconvergence residue and the twist's changed stance become
visible. SequenceDirector is deterministic post-processing — it repairs/derives coverage rather
than calling an LLM, and warns (does not abort) when a scene's beats are under-covered.

## Branch reconvergence carries residue (`BranchManager`)

`BranchManager` analyzes the concrete scene graph (it does NOT re-define the branch-and-bottleneck
framework — that's in the shared system prompt / `story-structure-rules`). Its twist/thread-relevant
job is **residue**: when branches rejoin at a `ReconvergencePoint`, emotional reset is forbidden.
Each reconvergence must reconcile differing state and carry residue forward through one or more of:

- **tone** (emotional footing)
- **knowledge / information** (what the player learned on that branch)
- **relationship** (trust/affection/respect/fear shifts)
- **identity** (who the protagonist became)
- **callbacks** (NPCs noticing branch-specific events)

A branch that only changes routing and leaves no visible residue should be a tint/callback instead.
`StateChange.significance` is `minor | moderate | major`; `ValidationIssue.type` includes
`orphan_branch`, `missing_reconvergence`, `state_conflict`, `unreachable_scene`, `dead_end`. Orphan
state (set but never read) is a design smell flagged here.

## See also
- `story-structure-rules` — owns the structural branch-and-bottleneck framework, bottleneck/branch
  zones, the distinct-experience rule, and stakes/consequence frameworks this skill builds on.
- `pipeline-validation` — the validator tiering and how `TwistQualityValidator` /
  `SetupPayoffValidator` errors vs warnings affect the run.
- `pipeline-agent-development` — extending `BaseAgent`, prompt/JSON-parse conventions, and the
  fail-open pattern these agents use.
- Source: `src/ai-agents/agents/TwistArchitect.ts`, `src/ai-agents/agents/ThreadPlanner.ts`,
  `src/ai-agents/agents/BranchManager.ts`, `src/ai-agents/agents/SequenceDirector.ts`.
- Validators: `src/ai-agents/validators/TwistQualityValidator.ts`,
  `src/ai-agents/validators/SetupPayoffValidator.ts`.
- Types: `src/types/narrativeThread.ts` (`ThreadKind` / `ThreadStatus` / `ThreadLedger`),
  `TwistPlan` / `TwistKind` in `TwistArchitect.ts`.
- Shared prompt: `src/ai-agents/prompts/storytellingPrinciples.ts`
  (`BRANCH_AND_BOTTLENECK`, `CHOICE_PAYOFF_AND_RECONVERGENCE`, `CORE_DRAMATIC_STRUCTURE_RULES`
  items 6–8: No Unearned Payoffs, Information Has Ownership, No Reset Units).
