# Mobile-First Reader Redesign

**Last Updated:** April 2026

Two passes of redesign are captured here: the original mobile-first reader layout, and the April 2026 rework that unified the reader and settings chrome around a small set of shared UI primitives.

---

## Original Mobile-First Reader

### Visual Layout
- **Full-screen edge-to-edge images**: Images now fill the entire viewport (9:19.5 aspect ratio).
- **Bottom-positioned UI**: Text and buttons are positioned in the bottom third/half of the screen.
- **Gradient overlay**: Dark gradient from transparent to opaque at the bottom for text legibility.
- **Minimal header**: Only a small menu button overlay in the top-left corner.

### Key Differences from the Previous Design

| | Old | New |
|---|---|---|
| Images | Small cards in a scrollable list | Full-screen background |
| Text | Inline list items | Overlays with dark backgrounds |
| Header | Terminal-style header bar | Floating menu button only |
| Anchor | Top-aligned | Bottom-anchored content area |
| Legibility | Plain | Gradient fade to dark |

### Image Requirements
- **Aspect Ratio**: 9:19.5 (full-bleed)
- **Safe Zone**: 9:16 (upper two-thirds for critical content)
- **Composition**: Critical elements inside the safe zone, atmospheric extension in the edges
- **Bottom Third**: Reserved for UI overlay (ground plane, shadows, ambient details)

### How to Verify the Reader
1. Hard refresh the browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows).
2. Open the devtools console and look for `[StoryReader]` logs to confirm image status.
3. Visually confirm: full-screen image, text in the bottom portion with a dark semi-transparent background, hamburger menu in the top-left, and no header bar.

If changes don't appear: restart `npm run web`, clear the browser cache, and confirm `src/screens/ReadingScreen.tsx` still has the latest code.

---

## April 2026 — Unified Reader & Settings UX

The reader and the settings screen shared a lot of similar-but-slightly-different chrome (headers, section cards, toggles, continue buttons, copy strings). The April 2026 pass extracted that chrome into a small shared library so both surfaces stay in sync automatically.

### Canonical Reader Copy

All continue/conclude button labels and outcome eyebrows live in a single source of truth:

```
src/theme/copy.ts
  ├── CONTINUE_COPY.default           → "CONTINUE"
  ├── CONTINUE_COPY.nextScene         → "CONTINUE"
  ├── CONTINUE_COPY.storylet          → "CONTINUE"
  ├── CONTINUE_COPY.recap             → "CONTINUE"
  ├── CONTINUE_COPY.growth            → "CONTINUE"
  ├── CONTINUE_COPY.encounterConclude → "CONCLUDE ENCOUNTER"
  ├── CONTINUE_COPY.encounterVictory  → "CONCLUDE ENCOUNTER"
  ├── CONTINUE_COPY.encounterResults  → "CONCLUDE ENCOUNTER"
  └── EYEBROWS.*                      → "EPISODE RECAP", "THE COST",
                                        outcome headers (success/complicated/failure)
```

**Rule:** never inline these strings in components — always import them from `src/theme/copy.ts`. This keeps beats, storylets, recaps, and encounters visually synchronised.

### Shared UI Primitives

A new `src/components/ui/` module hosts the reusable primitives that both the reader and the settings screen compose:

| Primitive | File | Used for |
|---|---|---|
| `ScreenHeader` | `ui/ScreenHeader.tsx` | Eyebrow + title + back button + trailing slot (Settings, Generator, Episode Select) |
| `SectionCard` | `ui/SectionCard.tsx` | Bordered card with optional eyebrow/title/description + trailing slot (Settings sections, Generator panels) |
| `SegmentedControl` | `ui/SegmentedControl.tsx` | Segmented value picker (font size, validation mode, encounter tier) |
| `Toggle` | `ui/Toggle.tsx` | Animated switch with inline label + helper text (developer mode, auto-narration, validation rules) |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | Modal confirm dialog, with a `destructive` variant (delete story, cancel job) |
| `ContinueButton` | `components/ContinueButton.tsx` | Canonical continue/conclude button that consumes `CONTINUE_COPY` keys |

The `ReadingShell` component (`src/components/ReadingShell.tsx`) wraps the reader surface so all reader screens share the same header spacing, safe-area insets, and choice layout.

### Settings Screen Composition

`SettingsScreen` is now a thin composition over primitives in `src/components/settings/`:

- `SettingsSections.tsx` — `DisplayPreferencesSection`, `DeveloperToolsSection`, `GenerationJobsSection`, `GeneratorLauncherSection`, `StoryLibrarySection`, `SystemInfoSection`.
- `SettingsModals.tsx` — `CancelJobModal`, `DeleteStoryModal`, `RenameStoryModal`.

Each section uses `SectionCard` + `Toggle`/`SegmentedControl` and every destructive action goes through `ConfirmDialog`, which means accessibility, keyboard handling, and visual treatment are guaranteed to match.

### Why This Matters

- **Consistency** — eyebrows, titles, back buttons, and continue buttons look identical across Home, Episode Select, Reader, Encounter view, Generator, and Settings.
- **Copy hygiene** — changing "CONTINUE" to "NEXT" is a one-line edit in `theme/copy.ts`.
- **Accessibility** — the primitives centralise `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, and the `minHeight: 44` touch target so every surface inherits the correct a11y behaviour.
- **Testability** — Playwright Tier-2 QA (see `test/e2e/storyPlaythrough.spec.ts`) relies on the canonical copy to locate the continue control — shared primitives keep those selectors stable.
