---
name: storyrpg-reader-playback
description: Use this skill when working on StoryRPG reading screens, story playback, fiction-first UI, StoryReader or ReadingScreen behavior, storyEngine resolution, conditions, consequences, player state, reader copy, or mobile playback UX.
---

# StoryRPG Reader Playback

## Workflow

Separate deterministic playback from presentation:

1. Inspect `storyrpg-prototype/src/engine/` for story progression, conditions, resolution, templates, and identity effects.
2. Inspect `storyrpg-prototype/src/stores/gameStore.ts` and persistence helpers for player state behavior.
3. Inspect `storyrpg-prototype/src/screens/ReadingScreen.tsx`, `StoryReader.tsx`, `ReadingShell.tsx`, and reader components for UI behavior.
4. Use `docs/MOBILE_REDESIGN.md`, `docs/GDD.md`, and `docs/TDD.md` as targeted references.

## Guardrails

- Preserve fiction-first UI: no visible stats, dice rolls, thresholds, or raw numerical mechanics.
- Keep full-screen image-backed reading legible on mobile and web.
- Use canonical reader copy from `storyrpg-prototype/src/theme/copy.ts`; do not inline continue/conclude labels.
- Prefer shared UI primitives in `storyrpg-prototype/src/components/ui/` for headers, cards, toggles, segmented controls, and confirmations.
- Do not change generation contracts to solve a playback-only issue unless the type model requires it.

## Common Checks

- Choice resolution and consequences: `storyEngine.ts`, `resolutionEngine.ts`, and `conditionEvaluator.ts`.
- Identity and relationship changes: `identityEngine.ts`, `relationshipStance.ts`, and player state persistence.
- Reader flow: beat advancement, encounter conclusions, recaps, growth consequences, and rewind behavior.
- Accessibility: touch targets, labels, modal semantics, and stable Playwright selectors.

## Verification

From `storyrpg-prototype/`, choose focused checks:

```bash
npm test -- storyEngine
npm test -- conditionEvaluator
npm test -- resolutionEngine
npm test -- rewindEngine
npm run typecheck
```

For visible reader changes, also verify in the browser or with the story playthrough e2e test.
