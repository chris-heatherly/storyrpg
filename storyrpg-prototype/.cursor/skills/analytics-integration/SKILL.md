---
name: analytics-integration
description: StoryRPG analytics via PostHog — the web (posthog-js) and native (posthog-react-native) clients, event capture in the reader, attribution, the sensitive-key scrubber, and the client-safe `phc_` key rule. Use when editing src/services/analyticsService.ts, src/config/posthog.ts, app.config.js analytics extras, or adding capture() calls.
---

# Analytics (PostHog) Integration

PostHog is already wired into StoryRPG. This skill is about working *with* the existing
integration. There are **two clients, one per runtime**:

- **Web** — `src/services/analyticsService.ts` (`posthog-js`). Primary path; the public reader is a
  web build. Consumed by `apps/reader/ReaderApp.tsx`, `src/screens/HomeScreen.tsx`, and
  `src/components/StoryReader.tsx`.
- **Native (iOS/Android)** — `src/config/posthog.ts` (`posthog-react-native`).

Both load config from `app.config.js` `extra` (`posthogProjectToken`, `posthogHost`), sourced from
`POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` env via `expo-constants`. Both treat the placeholder token
`phc_your_project_token_here` as unconfigured and **disable** capture (with a warn) instead of
firing to a bad endpoint.

## The `phc_` key rule (ties into `reader-generator-safety`)

PostHog publishable keys (`phc_…`) are the **only** client-safe key in this repo — they're meant to
ship in the public bundle, and the reader boundary scanner exempts `phc_`/`phx_`. Everything else
(provider keys: `AIza…`, `sk-…`, `sk-ant-…`) stays server-side behind the proxy and never lives in
an `EXPO_PUBLIC_` var.

## Never send story content to analytics

`analyticsService` scrubs event properties before sending: `SENSITIVE_KEY_PARTS` (text, prose,
prompt, name, description, synopsis, …) are stripped so generated prose, prompts, and character
names never leave the device. When adding a `capture()`, send **identifiers and counts**, not
narrative text — and route it through `analyticsService`, not a raw `posthog.capture`, so the
scrubber, the stable anonymous player id (`@storyrpg_analytics_player_id`), and UTM/referrer
attribution all apply.

## What the service already provides

- Stable anonymous player id + per-person counters in AsyncStorage.
- First-touch + latest-touch UTM/referrer attribution.
- `SafeAnalyticsProperties` narrowing (only primitives/arrays are sent).

Mirror a web event into the native client only when it matters on native.

## Checklist when adding analytics

1. Go through `analyticsService` (web) — never a raw client call that skips the scrubber.
2. Properties are ids/counts/enums, never prose/prompt/name.
3. The key is a `phc_` publishable token; no provider key leaks into the bundle (run
   `npm run verify:reader`).
4. Config still degrades gracefully when the token is the placeholder.

See also: `reader-generator-safety` (the `phc_` exemption + secret rules), `story-playback`.
