---
name: ux-design
description: Enforces UX consistency across StoryRPG player-facing components. Use when editing UI components, adding new screens, changing styles, or when the user mentions UX, design, visual consistency, theming, or animation.
---

# StoryRPG UX Design System

## Design Philosophy

**Fiction-Forward, Not Fiction-Only**: The UI reinforces narrative immersion while providing just enough game-mechanic visibility. What changed and its direction are visible (badges, skill flashes); how much (numbers) stays hidden.

## Theme Tokens

All colors MUST come from `src/theme/terminal.ts` via the `TERMINAL` constant. Never hardcode hex/rgba values directly in component styles.

### Key Color Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `colors.bg` | `#0f1115` | Main background, gradient stops |
| `colors.bgLight` | `#16191f` | Elevated surfaces |
| `colors.bgHighlight` | `#1e2229` | Placeholder backgrounds, modal backgrounds |
| `colors.primary` | `#3b82f6` | Primary blue accent, borders, links |
| `colors.primaryBright` | `#60a5fa` | Bright blue text, button text |
| `colors.primaryLight` | `#93c5fd` | Continue button text, resolution text, skill pills |
| `colors.success` | `#22c55e` | Positive outcomes, "up" direction badges |
| `colors.successLight` | `#86efac` | Advantage pill text, success badge glow |
| `colors.amber` / `colors.warning` | `#f59e0b` | Caution, complicated outcomes |
| `colors.amberLight` | `#fbbf24` | Butterfly banner header |
| `colors.error` | `#ef4444` | Failures, "down" direction badges |
| `colors.textBody` | `#cbd5e1` | Narrative prose, outcome text |
| `colors.textLight` | `#e2e8f0` | Badge labels, subtle light text |
| `colors.muted` | `#475569` | Disabled text, separators |
| `colors.mutedLight` | `#64748b` | Secondary info, dev panel subtitles |

### Semantic Opacity Helpers

Use helpers from `src/theme/uiConstants.ts`:
- `withAlpha(hex, alpha)` — converts a hex color to rgba

## Shared UI Constants (`src/theme/uiConstants.ts`)

### Border Radii

| Token | Value | Use For |
|-------|-------|---------|
| `RADIUS.panel` | `24` | Text panels, main content cards |
| `RADIUS.button` | `12` | Continue buttons, action buttons |
| `RADIUS.choice` | `16` | Choice buttons (ChoiceButton component) |
| `RADIUS.badge` | `10` | Consequence badges, skill pills |
| `RADIUS.small` | `8` | Dev badges, NPC state badges |

### Animation Durations

| Token | Value | Use For |
|-------|-------|---------|
| `TIMING.instant` | `80` | Press in/out micro-feedback |
| `TIMING.fast` | `200` | Selection highlights, quick fades |
| `TIMING.normal` | `300` | Standard fade-in, badge entrance, narrative text |
| `TIMING.slow` | `400` | Crossfade transitions, slide-out |
| `TIMING.dramatic` | `600` | Encounter entry, dramatic transitions |
| `TIMING.banner` | `500` | Butterfly banner slide-in |

### Standard Padding

| Token | Value | Use For |
|-------|-------|---------|
| `SPACING.panel` | `24` | Text panel internal padding |
| `SPACING.content` | `24` | Content container padding |
| `SPACING.contentBottom` | `40` | Bottom padding for scroll content |
| `SPACING.buttonV` | `14` | Vertical button padding |
| `SPACING.buttonH` | `24` | Horizontal continue button padding |
| `SPACING.choiceH` | `16` | Horizontal choice button padding |

## Canonical Component Styles

### Text Panel
```
backgroundColor: rgba(15, 17, 21, 0.85)
borderRadius: 24 (RADIUS.panel)
padding: 24 (SPACING.panel)
borderWidth: 1
borderColor: rgba(255, 255, 255, 0.1)
marginBottom: 16
shadow: { color: #000, offset: {0, 10}, opacity: 0.5, radius: 20 }
```

### Resolution Panel
```
backgroundColor: rgba(59, 130, 246, 0.15)
borderRadius: 16
padding: 16
borderLeftWidth: 4
borderLeftColor: TERMINAL.colors.primary
marginBottom: 16
```

### Resolution Text
```
color: TERMINAL.colors.primaryLight (#93c5fd)
fontSize: 16
lineHeight: 24
fontWeight: 500
fontStyle: italic
```

### Continue Button
```
backgroundColor: rgba(59, 130, 246, 0.2)
borderWidth: 1
borderColor: rgba(59, 130, 246, 0.3)
paddingVertical: 14
paddingHorizontal: 24
borderRadius: 12 (RADIUS.button)
gap: 10
alignSelf: center
```

### Continue Text
```
color: TERMINAL.colors.primaryLight (#93c5fd)
fontSize: 12
fontWeight: 900
letterSpacing: 2
```

### Consequence Badge
```
flexDirection: row
backgroundColor: rgba(255, 255, 255, 0.06)
borderWidth: 1
borderRadius: 12 (RADIUS.button)
paddingVertical: 10
paddingHorizontal: 14
gap: 10
arrow: { fontSize: 13, fontWeight: 900 }
label: { color: textLight (#e2e8f0), fontSize: 14, fontWeight: 700 }
hint: { color: rgba(255,255,255,0.55), fontSize: 13, fontStyle: italic }
```

### Outcome Header
```
fontSize: 20
fontWeight: 800
fontStyle: italic
letterSpacing: 0.5
marginBottom: 12
textAlign: left
color: TIER_COLORS[tier] (success=green, complicated=amber, failure=red)
```
Use `OutcomeHeader` component from `src/components/OutcomeHeader.tsx`.
Two label contexts: `story` (Well Played / Not Without Cost / A Costly Misstep) and `encounter` (Seizing the Moment / At a Price / A Turn for the Worse).
Tier labels and colors are defined in `TIER_LABELS` and `TIER_COLORS` from `src/theme/uiConstants.ts`.

### Stat Check Overlay
Use `StatCheckOverlay` component from `src/components/StatCheckOverlay.tsx`.
Full-screen skill flash (letter-spaced skill name, dark scrim) → tier color tint pulse → calls `onComplete`.
Used by both StoryReader (story stat checks) and EncounterView (encounter skill checks).

### Choice Button
Use `ChoiceButton` component from `src/components/ChoiceButton.tsx`.
Two variants via `variant` prop:
- `'standard'` (default): sword icon, chevron, skill pills, lock for gated choices
- `'minimal'`: no icons, centered text — used for storylet choices

### Reading Shell
Use `ReadingShell` component from `src/components/ReadingShell.tsx` for interstitial screens.
Provides the shared layout: full-bleed image → gradient overlay → scroll view → bottom-aligned content.
Used by episode recap and growth summary. Accepts `header` slot (e.g. encounter clocks) and `overlays` slot (e.g. StatCheckOverlay).

### Interstitial Card Pattern (`sharedStyles.section*`)
For recap, growth summary, and cost panels. All defined in `uiConstants.ts`:
- `sectionEyebrow`: uppercase, letter-spaced label (11px, 800 weight)
- `sectionTitle`: large bold heading (24px, 800 weight)
- `sectionGroup`: vertical section with gap
- `sectionGroupTitle`: amber uppercase section label
- `sectionCard`: bordered card (RADIUS.button, 1px border, dark bg)
- `sectionCardTitle`: card heading (16px, 700 weight)
- `sectionCardBody`: card body text (14px, textBody color)
- `sectionCardMeta`: italic meta text (13px, mutedLight)
- `sectionAltRow` / `sectionAltBullet` / `sectionAltText`: diamond-bullet list items

### Consequence Badge
```
flexDirection: row
backgroundColor: rgba(255, 255, 255, 0.06)
borderWidth: 1
borderRadius: 12 (RADIUS.button)
paddingVertical: 10
paddingHorizontal: 14
gap: 10
arrow: { fontSize: 13, fontWeight: 900 }
label: { color: textLight (#e2e8f0), fontSize: 14, fontWeight: 700 }
hint: { color: rgba(255,255,255,0.55), fontSize: 13, fontStyle: italic }
```
Use `ConsequenceBadgeList` component. Props:
- `layout`: `'stack'` (vertical, default) or `'inline'` (wrap, for compact views)
- `animated`: `true` (staggered entrance) or `false` (static, for recap screens)
- `maxVisible`: max badge count (default 5)

### Feedback Flow Pattern
After any choice (story, encounter, storylet):
1. **Immediate**: `ConsequenceToast` — auto-fading badge strip (~3.6s)
2. **Echo**: `echoPanel` on the target beat/scene — summary + up to 3 badges
3. **Summary**: Episode recap / growth summary — static badges with `animated={false}`
4. **Delayed**: `ButterflyBanner` — when past choices echo forward later in the story

## Rules

1. **No raw hex in StyleSheet**: Every color must trace back to TERMINAL or a `withAlpha()` call.
2. **Same component = same style**: If StoryReader and EncounterView both have a `resolutionPanel`, they must be identical.
3. **Use RADIUS/TIMING/SPACING constants**: Never write a magic number for border radius, animation duration, or padding.
4. **Storylet buttons use ChoiceButton**: Storylet choices use `<ChoiceButton variant="minimal">`, not plain `TouchableOpacity`.
5. **One badge component**: Use `ConsequenceBadgeList` everywhere; don't re-implement badge styles inline.
6. **Animation consistency**: Similar operations use the same duration token.
7. **One outcome header**: Use `OutcomeHeader` component for all tier labels; don't inline `Text` with tier color logic.
8. **One stat check overlay**: Use `StatCheckOverlay` for all skill check presentations (story and encounter).
9. **Shared interstitial card styles**: Use `sharedStyles.section*` for recap, growth, and cost panels — don't duplicate card styles locally.
10. **ReadingShell for interstitials**: Use `ReadingShell` for screens that need the full-bleed image + gradient + scroll layout.

## Audit Checklist

When editing any player-facing component:

- [ ] All colors reference TERMINAL or withAlpha()
- [ ] Border radii use RADIUS constants
- [ ] Animation durations use TIMING constants
- [ ] Resolution panel/text matches canonical spec
- [ ] Continue button matches canonical spec
- [ ] No duplicate style definitions across files
- [ ] Outcome headers use `OutcomeHeader` component
- [ ] Consequence badges use `ConsequenceBadgeList` (never inline)
- [ ] Stat checks use `StatCheckOverlay` component
- [ ] Interstitial cards use `sharedStyles.section*` pattern
- [ ] Storylet choices use `ChoiceButton variant="minimal"`
