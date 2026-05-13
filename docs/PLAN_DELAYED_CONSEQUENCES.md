# Plan 1 — Witcher-style Delayed Consequences

**Status:** Proposed
**Estimated effort:** ~1 week
**Cost impact:** +10% generation cost
**Companion plans:** [Post-Episode Flowchart UI](./PLAN_POST_EPISODE_FLOWCHART.md), [Multi-Scene Branch Zones](./PLAN_MULTI_SCENE_BRANCH_ZONES.md)

## Goal

Choices made in episode N change *text* (and occasionally images/audio) in episodes N+1 and N+2, without changing which scenes are visited. Same graph, richer memory.

## Why this first

Lowest-cost, highest "stories remember me" payoff. Most infrastructure already exists — the gap is systematic use.

## Prior art

- **The Witcher 3** — Baron's family, Keira Metz, Ciri's mood: choices pay off 10–40 hours later through dialog/text variants, not new scenes.
- **Mass Effect 2** — Paragon/Renegade flags referenced in unrelated later conversations.
- **Dragon Age: Origins** — Origin-story tag surfaces in dialog for dozens of hours.

## What the infrastructure already supports

| Capability | Where it lives |
|---|---|
| `Consequence` types (`setFlag`, `addTag`, `setScore`, `adjustRelationship`) | `src/types/consequences.ts` |
| `PlayerState.flags / tags / scores / relationships` | `src/stores/gameStore.ts` |
| `Condition` + `ConditionalText` evaluator | `src/engine/conditionEvaluator.ts` |
| Template interpolation (`{player.name}`) | `src/engine/templateProcessor.ts` |
| `ChoiceAuthor` emits consequences | `src/ai-agents/agents/ChoiceAuthor.ts` |

What's missing:
- Cross-episode awareness during generation.
- Systematic use of `conditionalText` variants in beats.
- A ledger/index of "callbacks owed."
- A validator that warns when an episode ignores prior-episode state.

## Implementation steps

### Step 1.1 — Introduce a callback ledger

New file: `src/ai-agents/pipeline/callbackLedger.ts`

```typescript
export interface CallbackHook {
  id: string;                    // e.g. "saved-the-cat"
  sourceEpisode: number;
  sourceSceneId: string;
  sourceChoiceId: string;
  flagsSet: string[];            // flags/tags this callback keys on
  summary: string;               // one-line prose, e.g. "You spared the wounded cat."
  payoffWindow: { minEpisode: number; maxEpisode: number };
  payoffCount: number;           // incremented each time a later beat references it
  resolved: boolean;
}

export class CallbackLedger {
  add(hook: CallbackHook): void;
  unresolved(forEpisode: number): CallbackHook[];
  recordPayoff(hookId: string): void;
  serialize(): string;
  static deserialize(raw: string): CallbackLedger;
}
```

Populated during `ChoiceAuthor` phase — every non-trivial consequence (anything that sets a flag/tag or shifts a score/relationship by ≥2) produces a ledger entry.

### Step 1.2 — Teach `SceneWriter` and `ChoiceAuthor` about unresolved callbacks

Before generating episode N, inject into the prompts:

> The player made these choices in previous episodes that have NOT yet paid off:
> - `saved-the-cat` (ep 1): spared a wounded cat in the alley
> - `killed-the-herald` (ep 2): executed the royal herald
>
> At least 2 of your beats in this episode must acknowledge one of these. Use `conditionalText` so only players who triggered the flag see the variant. When a callback has been referenced 2+ times in prose, mark it resolved.

**Files:**
- `src/ai-agents/agents/SceneWriter.ts` — new prompt section.
- `src/ai-agents/agents/ChoiceAuthor.ts` — same.
- `src/ai-agents/pipeline/FullStoryPipeline.ts` — assembles callback context, passes to agents, calls `ledger.recordPayoff()` when the agent output names a hook ID.
- New: `src/ai-agents/prompts/callbackPromptSection.ts` — reusable prompt fragment.

### Step 1.3 — Extend `Beat` authoring to emit conditional text variants

The schema already supports `conditionalText`. SceneWriter currently uses it rarely. Update its prompt to emit variants like:

```json
{
  "text": "The innkeeper nods at you.",
  "conditionalText": [
    {
      "condition": { "flag": "saved-the-cat", "op": "is", "value": true },
      "text": "The innkeeper nods at you. 'Hey, aren't you the one who saved that cat? My daughter's been talking about you.'"
    }
  ],
  "callbackHookId": "saved-the-cat"   // NEW: back-reference for ledger bookkeeping
}
```

Add `callbackHookId?: string` to the `Beat` type in `src/types/content.ts`.

### Step 1.4 — Runtime rendering

`templateProcessor.ts` and `StoryReader.tsx` already compose `conditionalText`. Two things to verify/fix:

1. **Specificity ranking** — when multiple `conditionalText` entries match, the one with the most conditions wins. Add if missing.
2. **Fallback** — `text` is always the fallback. No change needed.

**File:** `src/engine/templateProcessor.ts` — add specificity comparator.

### Step 1.5 — Callback coverage validator

New file: `src/ai-agents/validators/CallbackCoverageValidator.ts`

Warning-level check: for every episode past ep 1, there must be ≥1 beat whose `callbackHookId` references a previous-episode consequence.

Add to `IntegratedBestPracticesValidator` orchestration (warning, not blocking).

### Step 1.6 — Persistence

The ledger needs to survive across the multi-episode run. Serialize alongside existing pipeline artifacts in `generated-stories/<storyId>/`:

- `06-callback-ledger.json` — written after each episode.
- Loaded at episode start.

**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts` — wire save/load alongside `07-scene-plan.json` etc.

### Step 1.7 — Tests

- `src/ai-agents/pipeline/callbackLedger.test.ts` — unit tests for ledger ops.
- `src/engine/templateProcessor.test.ts` — extend with specificity ranking cases.
- Integration test: generate ep1 → manipulate flags → generate ep2 → assert ≥2 `callbackHookId` references in ep2 beats.

## File change summary

| File | Change |
|---|---|
| `src/ai-agents/pipeline/callbackLedger.ts` | **NEW** |
| `src/ai-agents/prompts/callbackPromptSection.ts` | **NEW** |
| `src/ai-agents/validators/CallbackCoverageValidator.ts` | **NEW** |
| `src/ai-agents/agents/SceneWriter.ts` | Inject callback section into prompt |
| `src/ai-agents/agents/ChoiceAuthor.ts` | Inject callback section; tag output hooks |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Assemble/persist ledger; call validator |
| `src/ai-agents/validators/IntegratedBestPracticesValidator.ts` | Register new validator |
| `src/types/content.ts` (`Beat`) | Add `callbackHookId?: string` |
| `src/engine/templateProcessor.ts` | Specificity ranking |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM forces callbacks awkwardly | Prompt says "only if it fits naturally; max 2 per episode." Validator is warning-level, not blocking. |
| Ledger balloons over long stories | Cap ledger at last 10 unresolved hooks; retire the oldest when capacity hit. |
| Conditional variants not playtested for all flag combinations | Add a `playtestAllBranches` script that exhaustively walks conditions and logs text variants. |
| Cost bump from longer prompts | Acceptable at +10%. Measure before/after on a fantasy-template baseline. |

## Success criteria

1. A fantasy-template story regenerated after implementation has ≥3 `callbackHookId` references per non-opening episode.
2. `CallbackCoverageValidator` passes for 90%+ of generated stories.
3. A manual playthrough with "mercy" choices produces visibly different NPC greetings in later episodes than a "cruelty" playthrough.

## Out of scope

- New scenes or branches (that's [Plan 3](./PLAN_MULTI_SCENE_BRANCH_ZONES.md)).
- UI that surfaces "here's what changed because of your choices" (that's [Plan 2](./PLAN_POST_EPISODE_FLOWCHART.md)).
- Callbacks that change encounter outcomes (future extension).
