# Plan 2 — Detroit-style Post-Episode Flowchart UI

**Status:** Proposed
**Estimated effort:** ~2 weeks
**Cost impact:** 0% (playback-only feature, no API calls)
**Companion plans:** [Delayed Consequences](./PLAN_DELAYED_CONSEQUENCES.md), [Multi-Scene Branch Zones](./PLAN_MULTI_SCENE_BRANCH_ZONES.md)

## Goal

After finishing an episode, show the player the DAG of everything they saw, greyed-out branches they missed, and a "replay from here" button. Makes existing branching feel meaningful *without* changing the data model.

## Why this second

The data is already there in the generated story JSON. This is a pure UI + state-tracking feature. High perceived value, medium cost, zero API cost. Can ship alongside [Plan 1](./PLAN_DELAYED_CONSEQUENCES.md) to double the "story remembered me" effect.

## Prior art

- **Heavy Rain / Detroit: Become Human** (Quantic Dream) — After every chapter, shows the flowchart with greyed-out branches. Big selling point. Treated as part of the narrative, not a debug tool.
- **Until Dawn** — "Butterfly Effect" screen showing triggered/missed consequences.
- **The Witcher 3** — No flowchart, but end-of-quest "Aftermath" cards that briefly describe the ripple effects.

## What you have

| Capability | Where it lives |
|---|---|
| Story-to-graph transformer | `src/visualizer/storyGraphTransformer.ts` |
| Graph visualizer components | `src/visualizer/` |
| `PlayerState.progress` (current pointer) | `src/stores/gameStore.ts` |
| Per-beat rendering + choice commit | `src/engine/storyEngine.ts`, `src/components/StoryReader.tsx` |
| Persisted player state across sessions | `src/stores/playerStatePersistence.ts` |

What's missing:
- No record of *which* beats were visited (only current pointer).
- No record of which choices were taken.
- No UI screen for "recap / flowchart."
- No "replay from here" navigation.

## Implementation steps

### Step 2.1 — Track visited nodes during playback

Extend `PlayerState`:

```typescript
// src/types/index.ts (or consolidated player state type)
interface PlayerState {
  // ...existing
  visitedBeatIds: string[];          // every beat shown (chronological, deduped)
  chosenChoiceIds: string[];         // every choice taken (chronological)
  episodeCompletions: Record<number, {
    completedAt: string;
    beatsVisited: number;
    choicesMade: number;
  }>;
}
```

Use arrays rather than `Set` so persistence is trivial (JSON-safe).

Update on every beat-render and choice-commit:

- `src/engine/storyEngine.ts` — emit `visitBeat(beatId)` when `advanceToNextBeat` fires.
- `src/stores/gameStore.ts` — new reducer cases `visitBeat`, `commitChoice`, `completeEpisode`.
- `src/components/StoryReader.tsx` — wire the existing beat-render lifecycle to dispatch `visitBeat`.
- `src/stores/playerStatePersistence.ts` and `encounterStatePersistence.ts` — persist new fields.

### Step 2.2 — Build `EpisodeRecapScreen`

New file: `src/screens/EpisodeRecapScreen.tsx`

Inputs: `storyId`, `episodeNumber`, the player's persisted state.

Renders:

1. **Episode graph** — filtered `storyGraphTransformer` output, scoped to this episode's scenes and encounters.
2. **Node coloring:**
   - **Solid/bright** — visited (in `visitedBeatIds`).
   - **Outlined/dim** — not visited but reachable from a choice the player saw (sibling choice branch).
   - **Greyed/locked** — gated by a condition the player didn't meet (e.g. required a flag they don't have).
3. **Edge labels** — the choice text that led to each branch.
4. **Bottom panel:**
   - "You made **N** unique choices across **M** decision points."
   - List of notable flags/tags raised this episode.
   - "Callbacks seeded for later" — references to the callback ledger if [Plan 1](./PLAN_DELAYED_CONSEQUENCES.md) is live.

New supporting files:

- `src/visualizer/episodeGraphBuilder.ts` — takes full-story graph + episode number + player state, returns a filtered/decorated subgraph with visit states attached.
- `src/components/recap/RecapBranchNode.tsx` — node component (solid/outlined/greyed styles).
- `src/components/recap/RecapBranchEdge.tsx` — edge component with label.
- `src/components/recap/RecapStatsPanel.tsx` — bottom panel.

Routing: add screen entry in `App.tsx`. Triggered from `ReadingScreen.tsx` on episode completion (before returning to `EpisodeSelectScreen`).

### Step 2.3 — "Replay from here" action

Each visited node gets a button that:

1. Clones the current save into a snapshot.
2. Rewinds `playerState.progress` to that beat.
3. Truncates `visitedBeatIds` and `chosenChoiceIds` to everything before that beat.
4. Clears flags set *only* by choices in the truncated tail (tricky — see risks).
5. Returns to `ReadingScreen` at that beat.

**Files:**
- `src/stores/gameStore.ts` — new `rewindToBeat(beatId)` action.
- `src/engine/rewindEngine.ts` (new) — deterministic "what was the player state at beat X" reconstruction, by replaying consequences up to but not including X.

Reconstruction approach: don't try to "undo" — instead, **replay from `initialState`** applying all consequences from `chosenChoiceIds[0..X-1]`. Deterministic because consequences are pure functions of state + choice.

### Step 2.4 — "What if" preview (cheap flavor)

Hovering a greyed-out / unvisited node shows a tooltip with the first sentence of that beat's text. The text is already in the JSON; you just weren't rendering it.

Careful: don't leak critical plot spoilers. Cap preview at ~80 chars and truncate with an ellipsis. Optional: a setting `revealUnvisitedPreview: 'off' | 'summary' | 'full'`.

### Step 2.5 — Aggregate stats (story-level, not episode-level)

Once per-story (on story completion):

- "You saw X% of the written story."
- "You chose the path of [most distinctive tag]."
- "Notable missed beats: 3 scenes, 12 choices."

Computed from `visitedBeatIds` / `chosenChoiceIds` vs. the total in the story JSON.

**Files:** `src/screens/StoryCompletionScreen.tsx` (new or extend existing).

### Step 2.6 — Enhanced encounter visualization

**Current:** `storyGraphTransformer.ts` represents encounters as **phase**-level nodes. Deep encounter outcome trees aren't expanded. This will undersell branching.

**Fix:** For recap screens only, pass an `expandEncounters: true` option to the transformer so each encounter expands into:

```
encounter-setup
├── choice-A
│   ├── outcome-success → next-situation / aftermath
│   ├── outcome-complicated → ...
│   └── outcome-failure → ...
└── choice-B
    └── ...
```

**Files:**
- `src/visualizer/storyGraphTransformer.ts` — new `encounterExpansion: 'phase' | 'full'` option.
- `src/visualizer/encounterSubgraphBuilder.ts` (new) — builds the full outcome tree from `EncounterStructure`.

### Step 2.7 — Copy & tone

UX gotcha: reader might feel bad about missing content. Copy must be celebratory, not FOMO.

- ✅ "Your path was 47 beats of betrayal and redemption."
- ❌ "You missed 53 beats."
- ✅ "Explore the roads not taken" button
- ❌ "Content you didn't see" header

### Step 2.8 — Tests

- `src/engine/rewindEngine.test.ts` — replay determinism: `replay(state, choices[0..N-1]) === stateBeforeChoiceN`.
- `src/visualizer/episodeGraphBuilder.test.ts` — correct visit states for a sample episode.
- Playwright E2E: complete ep1, see recap, click "replay from beat-3", verify we're back at beat-3 with prior state cleared.

## File change summary

| File | Change |
|---|---|
| `src/screens/EpisodeRecapScreen.tsx` | **NEW** |
| `src/screens/StoryCompletionScreen.tsx` | **NEW** or extend |
| `src/visualizer/episodeGraphBuilder.ts` | **NEW** |
| `src/visualizer/encounterSubgraphBuilder.ts` | **NEW** |
| `src/components/recap/RecapBranchNode.tsx` | **NEW** |
| `src/components/recap/RecapBranchEdge.tsx` | **NEW** |
| `src/components/recap/RecapStatsPanel.tsx` | **NEW** |
| `src/engine/rewindEngine.ts` | **NEW** |
| `src/stores/gameStore.ts` | Add `visitBeat`, `commitChoice`, `completeEpisode`, `rewindToBeat` |
| `src/stores/playerStatePersistence.ts` | Persist visit history |
| `src/engine/storyEngine.ts` | Emit visit events |
| `src/components/StoryReader.tsx` | Dispatch `visitBeat` |
| `src/visualizer/storyGraphTransformer.ts` | `encounterExpansion` option |
| `App.tsx` | Route entry |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Reconstructing player state at a past beat is fragile | Replay from `initialState` forward (pure functions). Snapshot + replay, don't try to undo. |
| Long histories blow up localStorage | Cap `visitedBeatIds` at 10,000 entries; rotate by story. |
| Encounters undersold on the flowchart | Step 2.6 expands encounter subgraphs. |
| Spoilers via hover preview | Step 2.4 cap + user setting. |
| Reader feels bad about missed content | Step 2.7 copy guidelines. |
| Mobile screen too small for full graph | Use progressive zoom; collapse non-visited nodes by default; expand on tap. |

## Success criteria

1. Completing an episode auto-navigates to the recap screen.
2. Recap shows ≥1 greyed-out branch per episode (assuming the story has any branching at all).
3. "Replay from here" reliably reconstructs player state within 200ms.
4. Zero new API calls during recap rendering.
5. Reader testing feedback on "did this change how you felt about the episode?" — target ≥70% positive.

## Out of scope

- Telemetry for "most players chose X" (needs backend + privacy review).
- Comparing playthroughs with a friend (social feature, later).
- Editing past choices in-place (too much engine surgery; replay-from is the compromise).
- Cross-story recap (story selector showing all completed stories).
