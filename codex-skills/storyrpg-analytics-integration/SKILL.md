---
name: storyrpg-analytics-integration
description: Use this skill when working on StoryRPG analytics — PostHog web (posthog-js) and native (posthog-react-native) clients, event capture in the reader, attribution, the sensitive-key scrubber, or the client-safe phc_ key rule.
---

# StoryRPG Analytics Integration

PostHog is already wired. Two clients, one per runtime: web `src/services/analyticsService.ts`
(`posthog-js`, the primary path, used by `apps/reader/ReaderApp.tsx`, `HomeScreen`, `StoryReader`)
and native `src/config/posthog.ts` (`posthog-react-native`). Config comes from `app.config.js`
extras (`posthogProjectToken`, `posthogHost`) sourced from `POSTHOG_PROJECT_TOKEN`/`POSTHOG_HOST`.

## Workflow

1. Add events through `analyticsService` (web), not a raw `posthog.capture` — the scrubber, stable player id, and attribution apply there.
2. Mirror an event into `src/config/posthog.ts` only if it matters on native.
3. Verify no provider key leaked into the bundle with `npm run verify:reader`.

## Guardrails

- `phc_` publishable keys are the ONLY client-safe key (the reader boundary exempts `phc_`/`phx_`). Provider keys stay server-side, never `EXPO_PUBLIC_`. See `storyrpg-reader-generator-safety`.
- Never send story content to analytics: `SENSITIVE_KEY_PARTS` (text, prose, prompt, name, description, synopsis…) are stripped. Send identifiers and counts, not narrative text.
- Both clients treat the placeholder token `phc_your_project_token_here` as unconfigured and disable capture — keep that graceful-degrade behavior.

## Common Checks

- Event properties are primitives/arrays (`SafeAnalyticsProperties`) — ids/counts/enums, not prose.
- Anonymous player id + UTM/referrer attribution persisted in AsyncStorage.
- Config resolution via `expo-constants` (`Constants.expoConfig?.extra?.posthog*`).

## Verification

From `storyrpg-prototype/`:

```bash
npm run typecheck
npm run verify:reader   # confirms no non-phc_ secret made it into the reader bundle
```
