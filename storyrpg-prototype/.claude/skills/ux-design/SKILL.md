---
name: ux-design
description: Use this skill when editing StoryRPG player-facing UI — components, screens, styles, theming, or animation. Enforces fiction-first presentation, theme tokens, and shared UI primitives so the reader stays visually consistent.
---

# UX Design

Fiction-forward, not fiction-only: the UI reinforces immersion while showing *what* changed and its
*direction* (badges, skill flashes) but never *how much* (numbers).

## Tokens — never hardcode

- Colors come from `src/theme/terminal.ts` (`TERMINAL`) via `withAlpha()` — no raw hex in `StyleSheet`.
- Radius / timing / spacing come from `src/theme/uiConstants.ts` (`RADIUS`, `TIMING`, `SPACING`) — no
  magic numbers. Tier labels/colors: `TIER_LABELS` / `TIER_COLORS`. Interstitial cards: `sharedStyles.section*`.
- Reader copy comes from `src/theme/copy.ts` — don't inline continue/conclude labels.

## One component per concern

Reuse the canonical components, don't re-implement their styles inline: `OutcomeHeader`,
`StatCheckOverlay` (story + encounter skill checks), `ChoiceButton` (`variant="minimal"` for
storylets), `ConsequenceBadgeList` (all badges), `ReadingShell` (full-bleed image + gradient +
scroll interstitials). Same component in two places ⇒ identical style.

## Fiction-first rule

Never render a score value, difficulty number, or dice roll. If you're about to, you're breaking the
design — surface direction/change-type instead. The feedback flow is: immediate `ConsequenceToast`
→ echo panel → recap/growth summary (`animated={false}`) → delayed `ButterflyBanner`.

## Verification

Styling has no pure unit test — verify visually: `npm run typecheck`, then `npm run dev` and inspect
the reader at `http://localhost:8081` (or the story-playthrough e2e).

See also: the Cursor `ux-design` skill (full token tables + canonical specs), `story-playback`,
`docs/MOBILE_REDESIGN.md`.
