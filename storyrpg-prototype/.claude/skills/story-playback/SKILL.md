---
name: story-playback
description: Use this skill when editing StoryRPG deterministic runtime playback — the story engine (src/engine/), player state (gameStore), fiction-first resolution, condition evaluation, encounters, or the StoryReader UI. This is the runtime half, separate from the AI generation pipeline.
---

# Story Playback

The deterministic runtime that reads a generated Story (no LLM): `src/engine/` (storyEngine,
resolutionEngine, conditionEvaluator, identityEngine, templateProcessor, rewindEngine),
`src/stores/gameStore.ts` (player state), `src/components/StoryReader.tsx` (~2.4k-line UI), and the
thin `src/screens/ReadingScreen.tsx` shell.

## Footguns

- **`gameStore` is React Context, NOT Zustand.** Use the granular hooks (`useGamePlayerState`,
  `useGameStoryState`, `useGameProgressState`, `useGameEncounterState`, `useGameActions`). Don't port
  it to Zustand (the `@ts-nocheck` + Context shape is intentional for re-render control).
- **Always mutate state through `useGameActions()`** (e.g. `applyConsequences`) so persistence,
  identity shifts, and delayed-consequence scheduling run. Never set `PlayerState` directly.
- **Reuse the resolution tracker singleton** via `getResolutionTracker()` — instantiating your own
  loses streak-bonus fairness state.
- **`evaluateCondition` is deliberately tolerant** of `null`/string/lazy-flag/missing-`type` shapes
  the generator produces. Don't "normalize" those away — you'll break older stories.
- **Encounters use `isEncounterBeat()`** to branch into their own state machine; don't mix beat and
  encounter consequence logic.

## Fiction-first rule

The player never sees raw numbers — no score values, difficulty numbers, or dice rolls. Direction
and change-type (up/down badges, skill flash) are OK; magnitudes are hidden. (UI components and the
badge system live behind the `ux-design` skill.)

## Verification

```bash
npm test -- storyEngine conditionEvaluator resolutionEngine rewindEngine
npm run typecheck
```

For visible changes, also check the reader in the browser or the story-playthrough e2e test.

See also: the Cursor `story-playback` + `ux-design` skills, `docs/GDD.md`, `docs/STORY_BRANCHING.md`.
