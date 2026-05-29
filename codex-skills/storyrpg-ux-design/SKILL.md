---
name: storyrpg-ux-design
description: Use this skill when editing StoryRPG player-facing UI — components, screens, styles, theming, or animation. Enforces fiction-first UI, theme tokens, and shared UI primitives so the reader stays visually consistent.
---

# StoryRPG UX Design

## Workflow

1. Pull colors from `src/theme/terminal.ts` (`TERMINAL`) and radii/timing/spacing from `src/theme/uiConstants.ts` (`RADIUS`, `TIMING`, `SPACING`, `TIER_COLORS`, `TIER_LABELS`, `sharedStyles.section*`).
2. Reuse shared primitives in `src/components/` before writing new styles.
3. Use canonical reader copy from `src/theme/copy.ts`; do not inline continue/conclude labels.

## Guardrails

- **Fiction-first**: never render raw numbers, dice rolls, DCs, or thresholds. Direction and change-type (badges, skill flashes) are OK; magnitudes are not.
- No raw hex in `StyleSheet` — every color traces to `TERMINAL` or `withAlpha()`.
- No magic numbers for radius/timing/padding — use the `RADIUS`/`TIMING`/`SPACING` tokens.
- One component per concern: `OutcomeHeader`, `StatCheckOverlay`, `ChoiceButton` (`variant="minimal"` for storylets), `ConsequenceBadgeList`, `ReadingShell` — don't re-implement their styles inline.
- Same component in two places ⇒ identical style.

## Common Checks

- Theme tokens exist and match (`terminal.ts`, `uiConstants.ts`).
- Components: `OutcomeHeader.tsx`, `StatCheckOverlay.tsx`, `ChoiceButton.tsx`, `ReadingShell.tsx`, `ConsequenceBadgeList.tsx`, `ConsequenceToast.tsx`, `ButterflyBanner.tsx`.
- Feedback flow: immediate toast → echo panel → recap/growth summary → delayed butterfly banner.

## Verification

Visual changes need a browser/Playwright check (no pure unit test for styling). From `storyrpg-prototype/`:

```bash
npm run typecheck
npm run dev   # then inspect the reader at http://localhost:8081
```

For deeper rules see the Cursor `ux-design` skill and `docs/MOBILE_REDESIGN.md`.
