---
name: storyrpg-proxy-worker
description: Use this skill when working on StoryRPG Express proxy routes, local dev server behavior, worker process lifecycle, job management, generated story file APIs, endpoint configuration, external API proxying, or proxy-side environment variables.
---

# StoryRPG Proxy Worker

## Workflow

Treat the proxy as the durability boundary:

1. Inspect `storyrpg-prototype/proxy-server.js` and the relevant module in `storyrpg-prototype/proxy/`.
2. Check endpoint constants in `storyrpg-prototype/src/config/endpoints.ts` before adding or changing URLs.
3. Check worker job state, cancellation, stdout event parsing, and generated story filesystem paths before changing client polling.
4. Use `docs/TDD.md` and `docs/INSTALL.md` for architecture and environment variable references.

## Guardrails

- The Express proxy is local-dev-only; do not turn it into a deployed backend without explicit scope.
- Keep API keys server-side unless an `EXPO_PUBLIC_` variable is intentionally needed in the client bundle.
- Do not hardcode proxy URLs or external endpoints outside `endpoints.ts`.
- Preserve generated story file layout and avoid runtime artifact churn.
- Keep long-running worker jobs resilient to refreshes, cancellations, and partial failures.

## Common Checks

- Route ownership: `proxy/` modules before editing `proxy-server.js` directly.
- Job lifecycle: start, poll, cancel, cleanup, dead-letter state, and worker process exit handling.
- File I/O: generated story JSON, images, audio, style-bible anchors, and LoRA artifacts.
- External APIs: Anthropic/OpenRouter/Gemini alternatives, image providers, ElevenLabs, and trainer sidecars.

## Verification

From `storyrpg-prototype/`, prefer focused checks:

```bash
npm run typecheck
npm test -- generationJob
npm test -- storyLibrary
```

Start `npm run proxy` only when route behavior needs live verification.
