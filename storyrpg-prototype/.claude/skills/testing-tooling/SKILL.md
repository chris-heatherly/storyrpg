---
name: testing-tooling
description: Use this skill when authoring StoryRPG tests or touching the test setup — Vitest unit tests, Playwright e2e, the react-native/AsyncStorage stubs, target-specific reader/generator typechecks, tsconfig/typecheck, npm run validate, boundary checks, and coverage workflow.
---

# Testing Tooling

Two test pyramids: **Vitest** unit (`src/**/*.test.ts` and `proxy/**/*.test.ts`,
`vitest.config.ts`) and **Playwright** e2e (`test/e2e/*.spec.ts`, `playwright.config.ts`).

## The gate

Run `npm run audit:skills` after changing pipeline contracts, commands, auth/media/package behavior,
or any Claude, Cursor, or Codex skill. `skills-manifest.json` defines capability parity and required
load-bearing facts across all three catalogs.

`npm run validate` runs in CI = `typecheck` (4 configs: app, test, contracts, worker) + `lint` +
`test`. **If you can't make validate green, don't merge.** E2E (`npm run test:e2e`) is *not* in
validate (needs a running server). Two extra typecheck configs — `tsconfig.reader.json` /
`tsconfig.generator.json` — run via `reader:typecheck` / `generator:typecheck`, separate from the
main `typecheck` (so reader-only type errors won't surface until you run those or `validate:reader`).
For reader bundle/deploy changes, add `check:reader-boundary` or `verify:reader`; for monolith-risk
pipeline extractions, add `check:monolith-size`.

## Vitest environment

Node, not jsdom: `environment: 'node'`, `globals: true`, with `react-native` and
`@react-native-async-storage/async-storage` aliased to `test/stubs/*` (passthrough RN, in-memory
AsyncStorage). For one jsdom test, add `// @vitest-environment jsdom` to that file — don't flip the project.

## Rules

- Co-locate tests (`Foo.ts` → `Foo.test.ts`); the glob picks them up.
- **Mock all external I/O** (`vi.fn()`) — never hit a real LLM/network/proxy in Vitest. Mock
  `BaseAgent.execute` for LLM-dependent validators.
- Inline fixtures or `__fixtures__/`; never depend on `generated-stories/`.
- Use `vi.useFakeTimers()` (+ `vi.runAllTimersAsync()`) instead of wall-clock waits.
- Coverage thresholds (~30/25/35/32) ratchet **up** only — never lower to unblock a merge.
- E2E is minutes of wall-clock; reserve it for full-system regressions.

See also: the Cursor `testing-tooling` skill, `vitest.config.ts`, `playwright.config.ts`.
