---
name: testing-tooling
description: Author tests for StoryRPG — Vitest unit tests, Playwright end-to-end tests, the React Native / AsyncStorage stubs, and the `npm run validate` / coverage workflow. Use when writing `*.test.ts`, editing `vitest.config.ts`, `playwright.config.ts`, `test/stubs/**`, `test/e2e/**`, or changing typecheck / lint / test scripts in `package.json`.
---

# Testing Tooling

## Scope — what this skill covers

StoryRPG has two parallel test pyramids:

| Layer | Runner | Config | Files |
|---|---|---|---|
| Unit | Vitest 4.x | `vitest.config.ts` | `src/**/*.test.ts` |
| End-to-end | Playwright | `playwright.config.ts` | `test/e2e/*.spec.ts` |

Plus the typecheck gate — four tsconfigs covered by `npm run validate`.

This skill is the source of truth for how to author, run, and extend tests. For what to test, see the subsystem-specific skills (`pipeline-validation`, `story-playback`, `image-generation-team`, etc.).

## The `npm run validate` contract

`npm run validate` runs in CI on every push. It is:

```
npm run typecheck   (4 tsconfigs: app, test, contracts, worker)
npm run lint
npm test            (Vitest, all files matching src/**/*.test.ts)
```

**If you cannot make validate green, do not merge.** This is the single gating command. Anything that is fast, deterministic, and matters for correctness belongs here.

E2E tests (`npm run test:e2e`) are **not** in `validate` because they require a running dev server. They run on demand.

## Vitest environment — Node with React Native stubs

```typescript
// vitest.config.ts
environment: 'node',
globals: true,
include: ['src/**/*.test.ts', 'proxy/**/*.test.ts'],  // proxy route modules are tested too
alias: {
  'react-native': 'test/stubs/react-native.ts',
  '@react-native-async-storage/async-storage': 'test/stubs/async-storage.ts',
},
```

Why Node + stubs instead of `jsdom`:

- The pipeline is pure logic and runs in Node (including inside the worker subprocess) — testing it in Node matches reality.
- The RN stub renders all components as trivial passthroughs so code that _imports_ RN (but is not really UI under test) doesn't explode.
- AsyncStorage stub is an in-memory `Map`, so `gameStore` persistence code paths work without a simulator.

**If you need jsdom for a specific test** — don't flip the project environment. Put `// @vitest-environment jsdom` at the top of that one test file.

### What NOT to do

- Don't import React Native components and expect them to render. Our stub is passthrough only. If you need real RN rendering, that's an E2E test.
- Don't reach into `test/stubs/*` from production code. They are a test fixture, not a runtime polyfill.
- Don't add a test that depends on wall-clock time (`Date.now()` drift, `setTimeout(..., 100)` in a race). Use `vi.useFakeTimers()`.

## Writing a good unit test

1. **Co-locate the test.** `src/foo/Bar.ts` → `src/foo/Bar.test.ts`. Vitest's `include` glob picks it up automatically.
2. **Test the public shape, not the class internals.** If you have to reach into `private` fields to assert, the test is brittle; refactor the public API first.
3. **Name the scenario, not the method.** ✅ `'flags a story with zero choice points as an error'`. ❌ `'validate() works'`.
4. **Keep fixtures inline or in a `__fixtures__/` sibling directory.** Never depend on a file in `generated-stories/`.
5. **Mock external I/O with `vi.fn()`, not with `nock` or the real network.** The proxy is not available during tests.
6. **Assert behaviour, not error strings.** Match on error codes or severity levels, not copy like `'Failed to save'`.

Example skeleton:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyValidator } from './MyValidator';

describe('MyValidator', () => {
  it('emits a warning when X happens', async () => {
    const validator = new MyValidator();
    const result = await validator.validate({ /* minimal input */ });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.level === 'warning')).toBe(true);
  });
});
```

## Coverage thresholds

`vitest.config.ts` sets baseline thresholds (statements/branches/functions/lines ≈ 30/25/35/32). They are deliberately set just under the measured values so CI does not red on small refactors.

Ratchet policy: when a phase lands that materially lifts coverage, bump the thresholds. Do not lower them to unblock a merge — fix the coverage regression instead.

Run with coverage:

```bash
npm run test:coverage
```

Report lands in `coverage/` (ignored by git). The HTML report is the nicest for finding uncovered branches.

## Playwright E2E — the full-story smoke

`test/e2e/storyPlaythrough.spec.ts` walks the full reader UX against a real dev server. Config highlights:

- `baseURL: process.env.E2E_BASE_URL || 'http://localhost:8081'` — the Expo web dev server.
- `fullyParallel: false`, `workers: 1` — stories have long async chains; parallelism causes flaky races.
- `timeout: 300_000` — 5 minutes per test.
- `trace: 'retain-on-failure'` — traces land in `test/e2e/report/`.

Before running locally:

```bash
npm run dev       # starts proxy + web on 8081
# then in another terminal:
npm run test:e2e
```

**Don't add new E2E tests casually.** Each one is minutes of wall-clock; they are reserved for full-system regressions (a story loads, a choice is resolved, audio plays, a consequence fires). Everything else goes in Vitest.

## TypeScript gate — four configs, not one

```
tsconfig.app.json        → the runtime app (narrow, Expo/RN types)
tsconfig.test.json       → widens types + includes test/stubs
tsconfig.contracts.json  → shared types between app + worker process
tsconfig.worker.json     → the worker-runner.ts node bundle
```

`npm run typecheck` runs all four. Two more configs exist for the reader/generator split —
`tsconfig.reader.json` and `tsconfig.generator.json` — run separately via
`npm run reader:typecheck` / `npm run generator:typecheck` (the reader one is also part of
`npm run validate:reader`). They are NOT in the main `typecheck`, so a reader-only type error
won't show up until you run the reader typecheck or the boundary verify. If you add a new top-level directory, decide which config(s) should include it — failing to add it to any means `tsc` silently skips type-checking it.

## Common footguns

1. **Test-only changes that break `tsconfig.app.json`.** The app config excludes tests; editing a test shouldn't change the app config, but it's easy to accidentally add `vitest/globals` to the wrong tsconfig. Check all four.
2. **Depending on generated stories.** They get cleaned regularly. Inline fixtures.
3. **Flaky fake timers.** `vi.useFakeTimers()` combined with `async/await` needs `vi.runAllTimersAsync()`, not `vi.runAllTimers()`.
4. **Testing LLM-dependent validators with a real LLM.** Mock `BaseAgent.execute` — never ever hit a real API in Vitest.
5. **Snapshot tests for LLM output.** LLMs are non-deterministic; snapshot a hand-crafted transformation, not a live response.
6. **Thresholds creeping down.** Ratchet up only.

## Checklist when adding a test

1. Is it `src/**/*.test.ts`? (Vitest picks it up automatically — no config change needed.)
2. Are all external dependencies (LLM, network, fs) mocked?
3. Does it pass on a cold run (no `generated-stories`, no ElevenLabs key)?
4. Does `npm run validate` still green?
5. If you raised coverage above the thresholds, did you ratchet them?
6. For E2E: is this genuinely a full-system regression, or would a unit test suffice?
