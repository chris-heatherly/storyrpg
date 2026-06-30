---
name: storyrpg-narrative-validation
description: Use this skill when working on StoryRPG narrative QA and the story-structure contract — seven-point structure, branch-and-bottleneck design, choice taxonomy, consequence budgets, encounter design, setup/payoff, branch divergence, callbacks, fiction-first mechanics, or story validator failures.
---

# StoryRPG Narrative Validation

## Workflow

Anchor every change in the canonical story contract:

1. Inspect `storyrpg-prototype/src/types/` for the exact story, episode, scene, beat, choice, condition, and consequence shapes.
2. Inspect validators in `storyrpg-prototype/src/ai-agents/validators/` before changing agent prompts.
3. Use `docs/GDD.md`, `docs/STORY_BRANCHING.md`, `docs/STORY_PIPELINE_PROMPTING.md`, and `docs/INCREMENTAL_VALIDATION_PLAN.md` as targeted references.
4. Confirm playback impact through `storyrpg-prototype/src/engine/` when validation affects conditions, consequences, or player state.

## Guardrails

- Preserve fiction-first gameplay: never expose stats, dice, thresholds, or raw mechanics to the player.
- Keep the seven-point structure load-bearing: `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, `resolution`.
- Prefer deterministic validation where possible; use LLM critique only for subjective prose quality.
- Do not weaken validators to pass bad output. Tighten prompts, remediation, or data flow first.
- Treat cosmetic branching warnings as design signals, not noise.

## Story Structure Contract (what the validators enforce)

These are the load-bearing rules; validators exist to protect them. Confirm shapes in `src/types/`.

- **3-act / 7-point spine** (`hook, plotTurn1, pinch1, midpoint, pinch2, climax, resolution`) is season-level and must appear in canonical order. `arc.climax` must match the season `StoryAnchors.climax`.
- **Branch-and-bottleneck**: branches must reconverge at bottlenecks; no dead ends, no orphan branches, no unreachable scenes. Encounters are always bottlenecks (~2–3 per episode).
- **Choice taxonomy + density**: types `expression`(~35%, never branches, no `nextSceneId`) / `relationship`(~30%) / `strategic`(~20%) / `dilemma`(~15%); ≥50% of scenes have a choicePoint, first scene always does, never >2 consecutive scenes without one.
- **Stakes triangle**: every choicePoint defines want / cost / identity. **Five-factor**: non-expression choices affect ≥1 of outcome/process/information/relationship/identity (major choices ≥3).
- **Consequence budget**: balanced mix of `setFlag` / `changeScore` / `addTag` / `relationship`; delayed consequences used sparingly (1–2 per episode).
- **Encounters**: encounter-first design, 3–5 beats, goal/threat clocks, branching `nextSituation` tree (not linear), victory/defeat/escape storylets.

## Common Checks

- Seven-point coverage: `SevenPointCoverageValidator` and `sevenPointDistribution.ts`.
- Setup/payoff and callbacks: `SetupPayoffValidator`, `CallbackOpportunitiesValidator`, and thread planning agents.
- Branch quality: `DivergenceValidator`, `SceneGraphBranchValidator`, and `storyPathAnalyzer`.
- Choice health: choice density, distribution, consequence budgets, and conditions.

## Verification

From `storyrpg-prototype/`, run the most specific validator tests available:

```bash
npm test -- SevenPointCoverageValidator
npm test -- DivergenceValidator
npm test -- Choice
npm run typecheck
```
