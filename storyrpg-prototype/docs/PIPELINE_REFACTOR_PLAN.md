# FullStoryPipeline decomposition plan (2026-06-09)

Goal: shrink `src/ai-agents/pipeline/FullStoryPipeline.ts` (23.3k lines,
`@ts-nocheck`) into a thin driver over typed `pipeline/phases/*` modules —
**without regression and without losing story coherence/quality**.

Story quality lives in *prompt context assembly* (season canon, callback
ledger, plant context, scene handoffs). So the spine of this plan is a harness
that proves the LLM-visible inputs are unchanged by each refactor step.

## Invariants (every PR)

1. **Pure move.** Extraction PRs never change behavior. No drive-by fixes, no
   reordering of context assembly, no "while I'm here."
2. **Byte-identical prompt snapshot.** The characterization run's captured
   prompt sequence must not change (see Phase 0). If a PR intends a prompt
   change, it is not an extraction PR.
3. `npm run validate` green; new files type cleanly (no new `@ts-nocheck`).
4. Monolith ratchet baseline **lowered in the same PR** (lock in the shrink).
5. Event/checkpoint sequence snapshot unchanged (resume + UI contract).

## Phase 0 — safety net (DONE except live items)

- `BaseAgent.setLlmTransportOverride` seam: every agent LLM call can be
  intercepted with the exact assembled request `{agentName, provider, model,
  messages}`. Production default: null.
- `src/ai-agents/testing/promptCapture.ts`: scripted transport (per-agent FIFO
  fixtures, loud `MissingFixtureError`), ordered capture, deterministic
  serialization (timestamps/durations stripped).
- Characterization test: `FullStoryPipeline.generate()` for a 1-episode
  text-only brief against scripted fixtures; golden file holds the ordered
  prompt sequence + normalized event/checkpoint sequence.
- Characterization extension (2026-06-10, the ContentGeneration
  prerequisite): two more golden-filed slices —
  `FullStoryPipeline.promptSnapshot.branching.test.ts` (a real branch point
  with per-target routed choices, a reconvergence scene with residue
  textVariants, and an encounter scene exercising EncounterArchitect's full
  phased flow: Phase 1 + 3× Phase 2 + Phase 3 + Phase 4) and
  `FullStoryPipeline.promptSnapshot.season.test.ts`
  (`generateMultipleEpisodes` for 2 episodes: shared foundation, season-canon
  sealing read back by episode 2's prompts, callback ledger, previousSummary
  handoff, ThreadPlanner/TwistArchitect enabled).
- `docs/refactor-baselines/replay-gates-baseline-2026-06-09.json`: frozen
  `npm run replay:gates` report over the local corpus for post-refactor
  comparison.

## Phase 1 — group state in place

Introduce explicit state objects inside the monolith (one PR each), no code
leaves the file: `SeasonState` (canon, callback/thread ledgers, twist plans,
season plans, cumulative telemetry — must survive the episode loop),
`EpisodeState` (per-episode buffers reset in `runContentGeneration`),
`MediaState` (asset registry, style anchors, LoRA, prefetches),
`RunContext` (job, events, checkpoints, telemetry, generation plan).
Field inventory + lifetimes: see the 2026-06-09 audit in session notes; the
critical invariant is season-scoped accumulators are seeded once per run
(`generateMultipleEpisodes` lines ~10990–11110) and never per episode.

## Phase 2 — extract phases leaves-first (per `pipeline/phases/README.md`)

Audio → BrowserQA → Video → Image (split master/scene/encounter) → QA →
QuickValidation → Assembly → EpisodeArchitecture+BranchAnalysis →
CharacterDesign+NPCDepth → **ContentGeneration last** (its call order over the
already-extracted helpers — plant context, callback orchestration,
thread/twist, prevention context — IS the coherence contract; move verbatim).

## Phase 3 — thin driver

`generate()` / `generateMultipleEpisodes()` keep only the episode loop, resume
partitioning, and state lifecycles. Remove `@ts-nocheck` from the residue.
Sync the three skill sets (`.claude/skills`, `.cursor/skills`, `codex-skills`)
that describe monolith navigation.

## Phase 4 — live validation (needs provider credits)

Regenerate Bite Me + Endsong from their treatments post-refactor; gen-audit;
`replay:gates` diff vs the frozen baseline; kill-and-resume a season mid-run
and verify sealed episodes match. Compare quality-ledger fields (opener
diversity, gate shadow outcomes) against g10/g11 baselines.
