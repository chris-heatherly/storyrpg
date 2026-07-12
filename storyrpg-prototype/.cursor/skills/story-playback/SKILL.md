---
name: story-playback
description: Work on StoryRPG deterministic runtime playback — the story engine, player state (gameStore, which is React Context not Zustand), fiction-first resolution, condition evaluation, and the StoryReader UI. Use when editing files in src/engine/, src/stores/gameStore.ts, src/components/StoryReader.tsx, src/screens/ReadingScreen.tsx, or any code that reads a generated Story at runtime (as opposed to generating one).
---

# Story Playback

## Scope — what this skill covers

This skill covers the **deterministic runtime** half of StoryRPG, which is separate from the AI generation pipeline:

Modern packages load through the story codec/story library and resolve media through
`src/assets/assetResolver.ts` (`AssetRef` first, legacy strings through migrations).

- `src/engine/` — pure TypeScript story navigation and mechanics
- `src/stores/gameStore.ts` — player state, story progress, encounter state, persistence
- `src/components/StoryReader.tsx` — the main playback UI component
- `src/screens/ReadingScreen.tsx` — thin screen shell that hosts `StoryReader`

If you are generating content or working on `src/ai-agents/**`, use the `pipeline-*` skills instead. If you are restyling UI, see `ux-design`.

## Architecture at a Glance

```
Story JSON (generated or seeded)
  │
  ▼
gameStore (React Context, not Zustand)        ← authoritative player + progress state
  │
  ▼
StoryReader.tsx  ──uses──▶  engine/storyEngine.ts
                              ├── resolutionEngine.ts    (fiction-first stat checks)
                              ├── conditionEvaluator.ts  (flag/score/relationship gates)
                              ├── identityEngine.ts      (identity shifts from choices)
                              └── templateProcessor.ts   (variable substitution in prose)
```

## `gameStore` is React Context, NOT Zustand (footgun)

Most other stores in `src/stores/` use Zustand (e.g. `appNavigationStore.ts` opens with `import { create } from 'zustand'`). **`gameStore.ts` is different** — it exposes `createContext` + a `GameStoreProvider` + granular hooks:

```typescript
useGamePlayerState()       // attributes, skills, relationships, flags, scores, tags, inventory, identity
useGameStoryState()        // current story + episode
useGameProgressState()     // current scene/beat + history
useGameEncounterState()    // encounter-specific runtime state
useGameActions()           // mutations (initializeStory, loadScene, applyConsequences, etc.)
useGameStore()             // combined accessor (prefer narrow hooks above)
```

File is `@ts-nocheck` pending a planned Phase 8 refactor. Do NOT "fix" it by porting to Zustand — the Context architecture is intentional for granular re-render control across many components.

Persistence: AsyncStorage under keys defined in `STORAGE_KEYS` at the top of the file (`gameStore_playerState`, `gameStore_currentSceneId`, `gameStore_sceneHistory`, `gameStore_branchHistory`, `gameStore_encounterState`, …). Serialization helpers live in `playerStatePersistence.ts` and `encounterStatePersistence.ts`.

## Fiction-First Resolution

The resolution engine uses a **geometric overlap model** (`resolutionEngine.ts`). Each stat check defines a shape in skill-space (`skillWeights`); the player has a shape from their effective stats. Success = how much they overlap. Randomness is the "bouncing ball."

Outcome tiers:
- `success` — clear victory
- `complicated` — partial with a cost
- `failure` — interesting failure that moves the story forward

### ResolutionTracker is a module-level singleton

`storyEngine.ts` exports `getResolutionTracker()` which returns a **single shared instance** (`const _resolutionTracker = new ResolutionTracker();` at the top of the module). This tracker accumulates consecutive failures and applies a streak bonus (`getStreakBonus()` returns up to +25 after 3 failures in a row) for session fairness.

Footguns:
- Do not new up your own `ResolutionTracker` in playback code — you will lose fairness state across checks.
- Do not reset the tracker between scenes. It is session-scoped, and that is intentional.
- If you need to test in isolation, import the class directly from `resolutionEngine.ts` and instance it yourself, but keep the runtime singleton path untouched.

## Condition Evaluation is Deliberately Tolerant

`conditionEvaluator.ts:evaluateCondition(condition, player)` handles multiple incoming shapes because generated JSON is messy:

- `null` / `undefined` → returns `true` (no condition)
- A bare string → treated as a flag name (`player.flags[condition] === true`)
- Missing `type` field → calls `inferConditionType()` which recognizes shortcuts like `{ flag_name: true }` (lazy flag check), attribute/skill/relationship key patterns, etc.
- Composite types: `and`, `or`, `not` recurse.

**Do not "normalize" condition JSON to strip these shortcuts** — they are valid input shapes the generator produces. Adding strict validation here will break playback on older stories. If you need to log, use the existing `console.log('[ConditionEvaluator] Inferred type ...')` pattern.

## Encounter vs Regular Beat Processing

`storyEngine.ts:isEncounterBeat(beat)` is the type-guard split. Encounters carry their own state machine (goal clock, threat clock, branching `nextSituation` tree) distinct from regular beats. `processBeat()` branches on `isEncounter` early and the two paths do not share consequence-application logic — keep them separate when adding features.

## Template Processor Observability

`templateProcessor.ts` substitutes variables (`{{character_name}}`, `{{flag_value}}`, etc.) into prose. The module-level counter `getUnresolvedTokenCount()` / `resetUnresolvedTokenCount()` is the canary for "something broke in my data" — a non-zero count means prose has unresolved template tokens visible to the player. Reset before a fresh story load; sample after major phases.

## StoryReader

`src/components/StoryReader.tsx` owns most playback complexity; `ReadingScreen.tsx` is a thin shell.
Most playback changes land in StoryReader.

Integration points to be aware of:
- Calls into `storyEngine` for navigation: `findScene`, `findBeat`, `executeChoice`, `getNextScene`, etc.
- Calls `resolveStatCheck` / uses `getResolutionTracker()` for choice resolution
- Reads/writes player state via `useGameActions()` and `useGamePlayerState()`
- Renders stat-check feedback through the `StatCheckOverlay` component (see `ux-design` skill for overlay UX rules)
- Applies consequences via `applyConsequences()` from `gameStore` actions — which internally runs `applyIdentityShifts` (identity engine) and schedules delayed consequences.

## Fiction-First UI Rule

The player must never see raw numbers. Direction and change type are OK (up-arrow badges, skill flash), but magnitudes stay hidden. If you find yourself rendering a score value, a difficulty number, or a dice roll, you are breaking the design. See `GDD.md` for the rationale and the `ux-design` skill for the badge components.

## Common Footguns

1. **Bypassing the resolution tracker** — calling `resolveStatCheck` without the singleton tracker loses streak-bonus fairness.
2. **Typing `gameStore` as a Zustand store** — it is a Context; JSX imports look like `useGamePlayerState()` not `useGameStore((s) => s.playerState)`.
3. **Exposing numbers in UI** — violates fiction-first.
4. **Mutating `PlayerState` directly** — always go through `useGameActions()` so persistence + identity + delayed-consequence hooks run.
5. **Over-normalizing condition JSON** — the evaluator tolerates loose shapes on purpose.
6. **Duplicating encounter logic in beat code paths** — route through `isEncounterBeat()` first.

## Checklist When Editing Playback Code

1. Did you go through `useGameActions()` for state changes (not raw setters)?
2. Did you reuse `getResolutionTracker()` rather than instantiating a new tracker?
3. Did you keep `evaluateCondition` tolerant of missing `type` / string / lazy-flag shapes?
4. Did you avoid surfacing numeric stats in the UI?
5. For encounters, did you branch via `isEncounterBeat()` and not mix beat/encounter consequence logic?
6. Did you apply template substitution through `templateProcessor` (and not ad-hoc string replace)?
7. If you changed persistence keys, did you update `playerStatePersistence.ts` / `encounterStatePersistence.ts` serializers AND add a migration path?
