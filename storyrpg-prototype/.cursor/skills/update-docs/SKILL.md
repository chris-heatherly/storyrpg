---
name: update-docs
description: >-
  Audit the codebase and update all documentation in docs/ and AGENTS.md to
  reflect current code reality. Use when the user asks to update docs, refresh
  documentation, sync AGENTS.md, or run a documentation audit. Also triggers
  on "update docs", "refresh docs", "docs out of date", or "doc audit".
---

# Update Documentation

Systematically audit the StoryRPG codebase and update every doc in `docs/` plus the root `AGENTS.md` to match current code reality.

## Quick Start

1. Run the audit script to get a structured diff report
2. Walk through each section of the report
3. Apply updates to AGENTS.md and each affected doc
4. Summarize what changed

## Step 1 — Run the Audit Script

```bash
bash storyrpg-prototype/.cursor/skills/update-docs/scripts/audit-docs.sh
```

Read the output. It produces a structured report comparing what docs say vs what the codebase actually contains, covering:
- Workspace file tree (new/removed files and directories)
- package.json versions and scripts
- Screens, stores, engine modules, AI agents, proxy routes, validators
- Environment variable references
- Cursor skills list

## Step 2 — Update AGENTS.md

AGENTS.md is the root orientation file. Update these sections in order:

### 2a. Workspace Layout tree
Compare the tree in AGENTS.md against the actual filesystem. Add new directories/files, remove deleted ones. Keep the same annotation style (`← description`).

### 2b. Tech Stack table
Read `storyrpg-prototype/package.json` for current dependency versions. Update the table rows for Expo, React, React Native, TypeScript, Zustand, etc.

### 2c. Key Files to Know table
Scan for new important files (new screens, new engine modules, new stores, new pipeline files, new agents). Remove rows for deleted files. Keep descriptions concise.

### 2d. Common Commands
Read the `scripts` block in `package.json`. Add new scripts, remove old ones, update descriptions.

### 2e. Environment Variables table
Grep for `process.env.` and `EXPO_PUBLIC_` across the codebase. Add new env vars to the table, remove unused ones.

### 2f. Data Model Summary
Read `src/types/index.ts` and check if major types have been added/removed/renamed. Update the hierarchy diagram.

### 2g. Conventions and Patterns
Check for new patterns (new tsconfig files, new test conventions, new polyfills, etc.).

### 2h. Deeper Documentation table
Compare the table against `docs/` directory listing. Add rows for new docs, remove rows for deleted ones.

## Step 3 — Update docs/ Files

For each doc below, read the doc and the corresponding source files, then fix any drift.

### GDD.md (Game Design Document)
- Cross-reference with screens, types, and engine for gameplay mechanics
- Check if new systems or UX flows have been added

### TDD.md (Technical Design Document)
- Cross-reference with types, engine, pipeline, proxy, and stores
- Update architecture diagrams, data model details, API surface
- Check for new subsystems or removed ones

### INSTALL.md
- Verify setup steps still work (Node version, npm install, env vars)
- Cross-reference env vars with what code actually reads
- Update troubleshooting if new common issues exist

### STORY_BRANCHING.md
- Cross-reference with `src/engine/storyEngine.ts` and `src/types/index.ts`
- Check if branching mechanics or choice types have changed

### STORY_PIPELINE_PROMPTING.md
- Cross-reference with `src/ai-agents/prompts/` and agent files
- Check if prompt contracts or agent signatures have changed

### STORY_AGENT_SYSTEM_DETAIL.md
- Cross-reference with `src/ai-agents/agents/` directory
- Check for new agents, removed agents, renamed agents

### IMAGE_PIPELINE_RUNTIME.md
- Cross-reference with `src/ai-agents/agents/image-team/` and `src/ai-agents/services/imageGenerationService.ts`
- Check for new image providers, changed image pipeline stages

### INCREMENTAL_VALIDATION_PLAN.md
- Cross-reference with `src/ai-agents/validators/`
- Check for new validators, changed validation stages

### QA_FIXES_SUMMARY.md
- Append any new recurring patterns or fixes found in recent code changes

### MOBILE_REDESIGN.md, PARALLEL_GENERATION.md
- Check if the status/plans described are still accurate

### Newer docs to keep in the audit
The `docs/` tree (repo root, NOT `storyrpg-prototype/docs/`) has grown — also reconcile:
`READER_GENERATOR_SPLIT.md` (vs `apps/` + the reader boundary), `STORY_QUALITY_CONTRACT.md`
(fiction-first contract), `LORA_TRAINING.md` (vs image-team LoRA code), `CURRENT_PIPELINE_STATUS.md`,
`IMAGE_PIPELINE_AUDIT.md`, `TECH_DEBT_AUDIT.md`, `PROJECT_AUDIT_2026-05-28.md`, and the
`STORY_TREATMENT_*` prompt docs. Visual-storytelling guidance now lives in code
(`src/ai-agents/prompts/visualPrinciples.ts`) — the old `visual_storytelling_*.md` docs were removed,
don't recreate references to them.

## Step 4 — Update Cursor Skills Table

If any new skill directories exist under `storyrpg-prototype/.cursor/skills/`, add them to the AGENTS.md table. Remove entries for deleted skills.

## Step 5 — Summarize

After all updates, provide a concise summary to the user:
- Which files were updated
- What the main changes were (new files, version bumps, removed items)
- Any docs that need human review (design intent changes can't be auto-detected)

## Important Rules

- **Never fabricate** — Only update docs based on what you observe in the code. If unsure, flag it for human review.
- **Preserve voice** — Each doc has a writing style. Match it when adding content.
- **Don't bloat** — Keep AGENTS.md concise. It's an orientation file, not an encyclopedia.
- **Skip reference/** — Files in `docs/reference/` are source materials, not maintained docs. Don't modify them.
- **Skip .env** — Never read or expose actual API key values.

## Appendix — Vitest Conventions

Helpful when a doc refresh mentions tests or when you need to verify a change before finalizing a docs update. Source: `vitest.config.ts`.

- **Environment**: Node (`environment: 'node'`). Runs headless — no JSDOM, no React renderer.
- **Globals enabled**: `describe`, `it`, `expect`, `vi` are auto-imported.
- **Include glob**: only `src/**/*.test.ts` runs. `.tsx` tests are not picked up; JSX components test via engine/state contracts instead.
- **Stubs**: two aliases under `test/stubs/`:
  - `react-native` → `test/stubs/react-native.ts`
  - `@react-native-async-storage/async-storage` → `test/stubs/async-storage.ts`
- **Excluded from coverage**: `node_modules/`, `test/`, `scripts/`, `proxy/`, `proxy-server.js`, `.test.ts(x)`, `.d.ts`, `src/data/stories/`, `coverage/`.
- **Coverage thresholds (Phase 9 baseline)**: statements 30%, branches 25%, functions 35%, lines 32%. Ratchet upward when coverage grows; never lower.
- **Running**: `npm test` (Vitest only) or `npm run validate` (typecheck + lint + tests). The validate script runs four typecheck configs: `tsconfig.app.json`, `tsconfig.test.json`, `tsconfig.contracts.json`, `tsconfig.worker.json`.
- **Writing new tests**: co-locate as `name.test.ts` next to the module; pure TS modules (engine, validators, converters, utils, stores with non-RN deps) are the happy path. UI component tests are out of scope for this harness.
