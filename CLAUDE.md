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
   **LLMs do the writing; deterministic systems enforce.** Deterministic code
   never authors or injects reader-facing prose — it enforces facts/criteria
   and, on failure, routes an LLM rewrite (retry-with-feedback or a repair
   handler). A run-survival placeholder is allowed only if its exact string is
   registered in `src/ai-agents/constants/syntheticFallbackProse.ts` (or
   `choiceTextFallbacks.ts` for choice outcome tiers) so the final contract
   blocks it and drives an LLM re-author. Enforced by
   `deterministicProseNeverShips.test.ts`.
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
- Reader runtime: `apps/reader/ReaderApp.tsx`, `src/screens/ReadingScreen.tsx`,
  `src/screens/HomeScreen.tsx`, `src/screens/EpisodeSelectScreen.tsx`,
  `src/screens/reader/ReaderSettingsScreen.tsx`, `src/stores/gameStore.ts`, `src/engine/`
- Proxy/worker: `proxy-server.js`, `proxy/`, `src/ai-agents/server/worker-runner.ts`

## Skills index (`storyrpg-prototype/.claude/skills/`)

- `reader-generator-safety` — the reader/generator boundary, `STORYRPG_APP_TARGET`,
  secret rules, and how to verify a reader change is safe. **Start here for any
  reader/deploy work.**
- `pipeline-debugging` — diagnosing generation failures, stuck worker jobs,
  validator/abort behavior, and the quality ledger.
- `pipeline-agent-development` — extending `BaseAgent`, LLM prompting/parsing, converters.
- `pipeline-validation` — validators + the story-structure contract they enforce.
- `story-structure-rules` — story-architecture craft: Story Circle spine, scene graph,
  branch-and-bottleneck, choice taxonomy, consequence budget, encounter design.
- `twist-and-thread-craft` — twist construction, narrative-thread lifecycle,
  foreshadow→reveal timing, path-aware payoffs, reconvergence residue
  (BranchManager / ThreadPlanner / TwistArchitect / SequenceDirector).
- `character-arc-and-voice-craft` — identity axes + deltas, arc phases, voice
  profiles, relationship dimensions by NPC tier, Want/Fear/Flaw, micro-lies
  (CharacterDesigner / CharacterArcTracker).
- `prose-and-scene-craft` — fiction-first prose, intensity tiering, show-don't-tell,
  the scene-turn contract, SceneCritic rewrite discipline (SceneWriter / SceneCritic
  / StyleArchitect).
- `worldbuilding-craft` — emergent lore, environmental storytelling, consistent rule
  systems, sensory immersion, location-design checklist (WorldBuilder).
- `media-generation` — image providers/LoRA + audio narration (ElevenLabs).
- `proxy-server` — Express proxy routes, worker lifecycle, and proxy auth-gating.
- `story-playback` — the deterministic runtime (engine, `gameStore`, fiction-first).
- `testing-tooling` — Vitest/Playwright, the four main tsconfigs, reader/generator target
  typechecks, boundary checks, `npm run validate`.
- `ux-design` — fiction-first UI, theme tokens, shared components.
- `integration-expo` — PostHog analytics (web + native) and the `phc_` key rule.

These are concise; **richer (Cursor-targeted) skills with the same coverage live under
`storyrpg-prototype/.cursor/skills/`**, and a Codex-targeted set under `codex-skills/` (each with an
`agents/openai.yaml`). Keep the three sets in sync when a skill's facts change.

## Recent context

See `docs/PROJECT_AUDIT_2026-05-28.md` for the current remediation roadmap
(landmines, guardrails, validator tiering, prompt caching) and what's done vs deferred.
