---
name: proxy-server
description: Work on the StoryRPG Express proxy server — the local Node process on port 3001 that brokers LLM/image/audio API calls, serves generated story files, manages generation jobs, and spawns the worker subprocess. Use when editing `proxy-server.js`, any file under `proxy/`, touching worker lifecycle, generation jobs, or adding new HTTP routes that the client / worker will call.
---

# Proxy Server

Account routes use Passport local/Google/Discord strategies with local/Postgres persistence; keep
`DATABASE_URL` and `SESSION_SECRET` server-side. Package/catalog routes treat `manifest.json` and
`story.json` as primary, resolve modern media through `AssetRef`, and support public content through
`npm run content:reader:export`.

## Scope — what this skill covers

The proxy is **local-dev infrastructure by default**, but it CAN be exposed publicly
(ngrok tunnel / deploy) — and it binds `0.0.0.0`, so it's reachable on the LAN/internet the
moment a tunnel is up. **Before exposing it you MUST auth-gate it**: set `PROXY_REQUIRE_AUTH=1`
and a `PROXY_API_TOKEN` (the gate also auto-enables when `NODE_ENV=production`). See
`proxy/proxyGuards.js` — leaving the tunnel up without auth exposes destructive routes and your
server-side provider keys. Provider keys are still always server-side: never behind `EXPO_PUBLIC_`.

It exists to:

1. Proxy LLM / image / audio API calls so keys stay server-side and CORS does not block the web build.
2. Serve generated story JSON + images under `/generated-stories/**`.
3. Own the durable state for generation jobs (`worker-jobs.json`, `worker-checkpoints.json`, `worker-dead-letter.json`).
4. Spawn and stream the worker subprocess that runs the AI pipeline.

If you are changing _pipeline_ code, see `pipeline-orchestration`. If you are changing _agent_ code, see `pipeline-agent-development`. This skill is about the HTTP surface and worker process lifecycle.

## Architecture at a Glance

```
Client (Expo web / native)
   │  HTTP
   ▼
proxy-server.js  ←──  registers all route modules
   │
   ├── proxy/anthropicProxyRoutes.js       LLM API proxy (Anthropic, OpenRouter, Gemini)
   ├── proxy/elevenLabsRoutes.js           TTS proxy
   ├── proxy/stableDiffusionRoutes.js      A1111 proxy
   ├── proxy/atlasCloudRoutes.js           Atlas Cloud image proxy
   ├── proxy/midApiRoutes.js               MidAPI / Midjourney proxy
   ├── proxy/fileRoutes.js                 generated-stories file I/O
   ├── proxy/storyMutationRoutes.js        POST-write story edits
   ├── proxy/catalogRoutes.js              Story catalog listing
   ├── proxy/generationJobRoutes.js        Job CRUD
   ├── proxy/workerLifecycle.js            ← owns worker subprocess + job state
   ├── proxy/workerJobSync.js              Mirrors worker events back to the job store
   ├── proxy/workerProgress.js             ETA / progress estimation
   ├── proxy/authRoutes.js                 ← auth gate (/auth) when PROXY_REQUIRE_AUTH=1 (authUserStore.js)
   ├── proxy/generatorSettingsRoutes.js    Server-side generator settings
   ├── proxy/modelScanRoutes.js            Local model discovery (Stable Diffusion / LoRA)
   ├── proxy/imageFeedbackRoutes.js        Image QA feedback capture
   ├── proxy/loraTrainingRoutes.js         LoRA training jobs
   └── proxy/memoryRoutes.js, styleRoutes.js, refImageRoutes.js, ...
```

Each route module exports a `register*Routes(app, deps)` function. `proxy-server.js` is the bootstrap — it constructs shared deps (catalog, cached stores, worker lifecycle), registers everything, and owns graceful shutdown.

## Golden rules

1. **Centralize endpoints** — the client never hardcodes URLs. All client-side URLs live in `src/config/endpoints.ts` (`PROXY_CONFIG.getProxyUrl()`). If you add a new route, add its path there.
2. **Route modules must not `require` each other's private state.** Share state only through the `deps` bundle `proxy-server.js` passes in. Otherwise hot-reload and tests break.
3. **`createCachedJsonStore` is the canonical persistence primitive** for proxy-side JSON (jobs, checkpoints, deleted-stories list). Do not write directly to disk inside a route handler — use a cached store.
4. **Never log API keys or dumped prompt text at INFO level.** The request logger (`[Proxy] METHOD URL`) is fine; bodies are not.
5. **All HTTP handlers that touch the filesystem must be defensive against path traversal.** `fileRoutes.js` and `storyMutationRoutes.js` already resolve + check against `STORIES_DIR`; copy that pattern.

## Worker lifecycle — read `proxy/workerLifecycle.js` first

This module owns the most dangerous part of the proxy: spawning a long-lived Node subprocess, streaming its stdout JSON events, and mirroring them into the job / checkpoint stores.

Key concepts (all defined at the top of `workerLifecycle.js`):

- `WORKER_STALE_RUNNING_MS` — heartbeat threshold; after this a "running" worker is considered stale.
- `WORKER_COMPLETED_PRUNE_MS` — how long finished jobs linger before GC.
- `WORKER_RESULT_TTL_MS` — in-memory result cache lifetime (so the client can pick up results after reconnect).
- `activeWorkers` — `Map<jobId, WorkerState>` in-memory registry of spawned children.
- `workerStreamClients` — SSE/long-poll subscribers per job.
- `worker-jobs.json` / `worker-checkpoints.json` / `worker-dead-letter.json` — the three durable stores.

Footguns:

- **Do not add logic inside `startWorkerProcess()` that assumes the caller awaits completion.** The function returns as soon as spawn succeeds; completion is handled via the stdout stream.
- **Dead-letter append is idempotent on `jobId`.** If you push to it, use the existing helper, not `fs.appendFile`.
- **`stripLargeValues(obj, maxStringLen)` at the top of the file MUST be used** before persisting anything that came from an agent — pipeline events can carry huge prompts and base64 blobs that would bloat the JSON store.

## Job flow (who writes what, when)

```
Client POST /generation-jobs           → generationJobRoutes.js
       │                                   writes job to worker-jobs.json
       ▼
Client POST /generation-jobs/:id/start  → workerLifecycle.startWorkerProcess()
       │                                   spawns `node dist/worker-runner.js`
       ▼
Worker stdout JSON events               → workerJobSync.handleWorkerEvent()
       │                                   updates job status + checkpoints
       ▼
Client GET  /generation-jobs/:id/events → SSE stream fed by workerStreamClients
```

Never shortcut this flow from the client by writing jobs directly to disk. If you need a synthetic job for testing, use the `POST /generation-jobs` endpoint.

## When adding a new route module

1. Create `proxy/<feature>Routes.js` exporting `registerFooRoutes(app, deps)`.
2. In `proxy-server.js`, add the `require` at the top with the other route requires and call it in the registration block near the bottom.
3. If the route needs persistence, build it with `createCachedJsonStore` at bootstrap time and pass the store through `deps`.
4. Add the route URL to `src/config/endpoints.ts` under an appropriately named getter.
5. If the client uses the route, wire its call through `PROXY_CONFIG.getProxyUrl()` — never hard-code `http://localhost:3001`.

## When adding a new external-API proxy

Follow the shape of `anthropicProxyRoutes.js`:

1. Pull the secret from `process.env` at module scope, not per-request.
2. Strip the `Authorization` header from the _incoming_ request; set your own on the outgoing one.
3. Forward only the necessary headers (`content-type`, model-family headers). Never forward cookies or CORS headers.
4. Apply the transport budget from `llm-transport-policy.js` (`getLlmTransportBudgets()`) so runaway prompts get rejected at the edge rather than billed.
5. Stream the response if the upstream supports streaming — the pipeline relies on token-level streaming in some phases.

## Common footguns

1. **Mutating `activeWorkers` from outside `workerLifecycle.js`** — the consistency guarantees are lost. Expose a helper instead.
2. **Forgetting to call `stripLargeValues` before persisting** — `.worker-checkpoints.json` has hit 50+ MB from a single errant run before this was enforced.
3. **Mixing bind address / port assumptions** — `PORT` comes from `process.env.PORT || 3001`. The client reads `EXPO_PUBLIC_PROXY_URL` which must match. Changing one requires changing the other.
4. **Blocking the event loop with `fs.readFileSync` inside a hot route** — use the cached stores, which memoize on read.
5. **Skipping `STORIES_DIR` resolution** when adding a file route — path traversal is the #1 security risk in this layer.

## Checklist when editing the proxy

1. Did you add new URLs to `src/config/endpoints.ts` (not the route handler only)?
2. If you added state, is it flowing through the `deps` bundle rather than a module-level singleton?
3. If you write to disk, did you use `createCachedJsonStore` or explicitly justify why not?
4. Did you strip large values before persisting worker events?
5. Did you update `docs/TDD.md`'s "Proxy API surface" section if you added a new route family?
6. Are there tests? Route modules should be testable by constructing an `express()` app, registering the module, and hitting it with `supertest`-style fetches.
