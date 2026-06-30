---
name: integration-expo
description: Use this skill for StoryRPG analytics — PostHog wiring across web (posthog-js) and native (posthog-react-native), event capture in the reader, attribution, the sensitive-key scrubber, and the client-safe `phc_` key rule. Use when editing src/services/analyticsService.ts, src/config/posthog.ts, app.config.js analytics extras, or adding capture() calls.
---

# Analytics (PostHog) integration

StoryRPG already has PostHog wired — this skill is about working *with* the existing
integration, not bootstrapping a new one. There are **two clients, one per runtime**:

- **Web** — `src/services/analyticsService.ts` (uses `posthog-js`). This is the primary path;
  the public reader is a web build (Vercel). It is consumed by `apps/reader/ReaderApp.tsx`,
  `src/screens/HomeScreen.tsx`, and `src/components/StoryReader.tsx`.
- **Native (iOS/Android)** — `src/config/posthog.ts` (uses `posthog-react-native`).

Both read config from `app.config.js` `extra` (`posthogProjectToken`, `posthogHost`), which come
from `POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` env vars via `expo-constants`. Both treat the
placeholder `phc_your_project_token_here` as "unconfigured" and disable capture (with a warn)
rather than firing to a bad endpoint.

## The key rule (ties into `reader-generator-safety`)

PostHog **publishable** keys start with `phc_` and are the *one* client-safe key in this repo —
they are designed to ship in the public bundle, and the reader boundary scanner explicitly exempts
`phc_`/`phx_`. This is the only exception: no provider API key (`AIza…`, `sk-…`, `sk-ant-…`) ever
goes in a client/`EXPO_PUBLIC_` var. Keep analytics keys publishable; keep everything else
server-side behind the proxy.

## Never send story content to analytics

`analyticsService` scrubs properties before sending: `SENSITIVE_KEY_PARTS` (text, prose, prompt,
name, description, synopsis, …) are stripped so generated prose, prompts, and character names never
leave the device as event properties. When adding a `capture()` call, send **identifiers and
counts**, not narrative text. Don't bypass the service's sanitizer with a raw `posthog.capture`.

## What the service already does

- Stable anonymous player id in AsyncStorage (`@storyrpg_analytics_player_id`).
- First-touch + latest-touch UTM/referrer attribution capture.
- Per-person counters.
- Property-type narrowing (`SafeAnalyticsProperties`) so only primitives/arrays are sent.

Add new events through `analyticsService` so the id, attribution, and scrubbing all apply
uniformly. Mirror any web event into the native client (`src/config/posthog.ts`) only if the event
matters on native.

## References

`references/` holds upstream PostHog/Expo onboarding docs (SDK package names, `PostHogProvider`
wiring, identify patterns, reverse-proxy `/static/*`+`/array/*` routing). Consult them for SDK API
detail — but the StoryRPG-specific truth is the two files above, not the generic onboarding flow.

See also: the `reader-generator-safety` skill (the `phc_` exemption + secret rules), `app.config.js`.
