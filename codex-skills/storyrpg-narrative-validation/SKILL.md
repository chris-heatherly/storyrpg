---
name: storyrpg-narrative-validation
description: Use this skill when working on StoryRPG narrative QA, seven-point story structure, setup and payoff validation, branch divergence, choice density, callback opportunities, fiction-first mechanics, or story validator failures.
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
