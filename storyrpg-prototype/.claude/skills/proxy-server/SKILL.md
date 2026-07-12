---
name: proxy-server
description: Use this skill when editing the StoryRPG Express proxy (proxy-server.js, proxy/**) — provider proxying, Passport auth/sessions, Postgres/local accounts, generated-story package/catalog APIs, generation jobs, worker lifecycle, endpoint config, or server-side secrets.
---

# Proxy Server

`proxy-server.js` bootstraps the local Node process that brokers provider API calls (so keys stay
server-side and CORS doesn't block the web build), serves `/generated-stories/**`, owns
generation-job + worker state, and spawns the worker subprocess. Each route module under `proxy/`
exports `register*Routes(app, deps)`.

Modern delivery is package-first: catalog/story routes use `manifest.json` + `story.json`, modern
media uses `AssetRef`, and public content uses `npm run content:reader:export`. Auth uses Passport
local/Google/Discord strategies plus local/Postgres persistence; keep `DATABASE_URL` and
`SESSION_SECRET` server-side.

## Auth & exposure (don't get this wrong)

The proxy is local-dev by default but **binds `0.0.0.0`** and can be exposed (ngrok/deploy). Before
exposing it you **must** set `PROXY_REQUIRE_AUTH=1` + `PROXY_API_TOKEN` (auto-on under
`NODE_ENV=production`) — see `proxy/proxyGuards.js`. An unauthenticated tunnel exposes destructive
routes and your provider keys. Provider keys are always server-side (`process.env.X`), never
`EXPO_PUBLIC_X`; the only client-safe key is the PostHog `phc_` publishable key.

## Conventions

- **Centralize endpoints**: client URLs live in `src/config/endpoints.ts` (`PROXY_CONFIG.getProxyUrl()`),
  never hardcoded. Add a new route's path there too.
- Share state only through the `deps` bundle — route modules must not `require` each other's private state.
- Use `createCachedJsonStore` for proxy-side JSON persistence; don't `fs.writeFile` inside a handler.
- `stripLargeValues(...)` before persisting worker events (pipeline events carry huge prompts/base64).
- File routes must resolve + check against `STORIES_DIR` (path-traversal guard).
- Worker lifecycle (`proxy/workerLifecycle.js`) owns the most dangerous part — spawn, stdout-event
  stream, checkpoint/dead-letter stores. `startWorkerProcess()` returns on spawn, not completion.

## Verification

```bash
npm test -- generationJob storyLibrary
npm run typecheck
npm run proxy   # only when route behavior needs live verification
```

See also: the Cursor `proxy-server` + `pipeline-orchestration` skills, `reader-generator-safety`,
`docs/TDD.md`.
