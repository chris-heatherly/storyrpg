# StoryRPG — Claude Code orientation

**Read [`AGENTS.md`](AGENTS.md) first** — it is the full orientation (architecture,
data model, commands, conventions). This file is a thin pointer plus the
non-negotiables and the skills index.

All app code and commands live in `storyrpg-prototype/`. Run commands from there.

## Non-negotiables

1. **Reader ≠ Generator.** The app has two web targets selected by
   `STORYRPG_APP_TARGET`: **reader** (public playback, port 8081) and
   **generator** (internal creation, port 8082). The reader must NOT import
   generator code (`src/ai-agents`, generation stores, provider settings) and
   must NOT carry provider API keys. Before any reader-affecting change run
   `npm run check:reader-boundary` (and `npm run verify:reader` for the bundle
   secret scan). See the `reader-generator-safety` skill.
2. **Provider keys are server-side.** Never put a provider API key behind an
   `EXPO_PUBLIC_*` var (Expo inlines those into the client bundle). PostHog
   publishable keys (`phc_`) are the only client-safe keys.
3. **Don't bypass the proxy.** API calls that belong behind the Express proxy
   (`proxy-server.js` + `proxy/`) must go through it. The proxy is auth-gated
   when exposed (`PROXY_REQUIRE_AUTH=1`); keep it that way before any tunnel/deploy.
4. **Fiction-first.** Player-facing prose never exposes stats, dice, DCs,
   percentages, or system math. See `docs/STORY_QUALITY_CONTRACT.md`.
5. **Don't edit generated artifacts.** `generated-stories/`, job-state JSON,
   `.model-cache.json`, and `*.backup-*` are runtime output (gitignored) — never
   hand-edit or commit them.
6. **Guardrails are enforced.** CI runs typecheck + lint (`--max-warnings`
   ratchet) + `test:coverage` + boundary + monolith ratchet, and a pre-commit
   hook (`.githooks/pre-commit`) blocks staged artifacts. New `@ts-nocheck` is
   blocked outside the existing allowlist. Don't grow `FullStoryPipeline.ts` /
   `imageGenerationService.ts` — extract instead.

## Where the work lives

- Generation pipeline: `src/ai-agents/pipeline/FullStoryPipeline.ts` (huge —
  navigate by phase, see `pipeline/phases/`, `planningHelpers.ts`,
  `choiceAssembly.ts`; don't read the whole file). Diagnostics per run:
  `generated-stories/<run>/99-pipeline-errors.json`; cross-run quality/success:
  `generated-stories/quality-ledger.jsonl`.
- Agents: `src/ai-agents/agents/`  · Validators: `src/ai-agents/validators/`
- Reader runtime: `src/screens/reader`, `src/stores/gameStore.ts`, `src/engine/`
- Proxy/worker: `proxy-server.js`, `proxy/`, `src/ai-agents/server/worker-runner.ts`

## Skills index (`.claude/skills/`)

- `reader-generator-safety` — the reader/generator boundary, `STORYRPG_APP_TARGET`,
  secret rules, and how to verify a reader change is safe. **Start here for any
  reader/deploy work.**
- `pipeline-debugging` — diagnosing generation failures, stuck worker jobs,
  validator/abort behavior, and the quality ledger.

Richer (Cursor-targeted) skills also exist under `storyrpg-prototype/.cursor/skills/`.

## Recent context

See `docs/PROJECT_AUDIT_2026-05-28.md` for the current remediation roadmap
(landmines, guardrails, validator tiering, prompt caching) and what's done vs deferred.
