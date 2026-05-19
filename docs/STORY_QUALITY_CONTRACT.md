# Story Quality Contract

**Status:** Active rule contract for the current `FullStoryPipeline`.

This document captures what StoryRPG keeps from the older pipeline: durable
story and image-quality rules, not the old orchestration model.

## Narrative Rules

- **Fiction first:** player-facing prose never exposes raw stats, dice,
  percentages, thresholds, or system math. Mechanics should appear as risk,
  leverage, preparation, relationship behavior, identity pressure, or cost.
- **Meaningful agency:** every non-flavor choice must affect at least one of
  outcome, process, information, relationship, or identity.
- **Choice stakes:** meaningful choices should carry want, cost, and identity.
- **Consequence budget:** default to callbacks and scene tints; use branchlets
  for important moments; reserve structural branches for major turns.
- **Convergent spine:** branches create different experiences between
  bottlenecks, then reconverge at planned anchors without erasing residue.
- **Delayed memory:** important choices should echo later through conditional
  text, NPC recognition, altered descriptions, relationship tone, visual state,
  or later choice wording.
- **Pixar-style craft:** clear desire, escalating pressure, earned surprise,
  setup/payoff, causality, character change under pressure, and emotional
  payoff. This is a rubric, not a separate agent or rigid formula.

## Visual Rules

- **Storyboard sheets are continuity authority.** Panel metadata and storyboard
  sheets define continuity; previous-panel refs are same-path helpers only.
- **Every image tells one beat:** action, emotion, and relationship should be
  readable without captions.
- **Universal defects stay blocked:** accidental text, duplicate intended
  character, watermarks, reference-sheet artifacts, default first-person or
  disembodied POV, identity drift, and mobile-unsafe focal content.
- **Style-aware judgment:** cinematic depth, high contrast, asymmetry, and
  motion are not universal. `ArtStyleProfile` decides which visual traits are
  desirable or allowed.
- **Provider-aware refs:** reference packs must respect active provider
  capabilities and reserve high-value slots for character, style, location, and
  storyboard continuity anchors.

## Validator Ownership

| Rule | Validator / Owner |
|---|---|
| Choice impact factors | `ChoiceImpactValidator` |
| Raw mechanics leakage | `MechanicsLeakageValidator` |
| Callback coverage | `CallbackCoverageValidator`, `CallbackOpportunitiesValidator` |
| Consequence budget | `ConsequenceBudgetValidator` |
| Branch graph validity | `SceneGraphBranchValidator`, `DivergenceValidator` |
| Setup/payoff | `SetupPayoffValidator` |
| Twist / earned surprise | `TwistQualityValidator`, `PixarPrinciplesValidator` |
| Character change | `ArcDeltaValidator`, `SceneCraftValidator` |
| Visual defects | storyboard-v2 QA, `imageDefectGate`, visual validators |
| Provider refs | `referencePackBuilder`, `referenceStrategy`, `providerCapabilities` |

## Deprecated Structure Boundary

| Deprecated / Legacy Item | Replacement | Compatibility Policy | Status |
|---|---|---|---|
| `ParallelStoryPipeline` | `FullStoryPipeline` | No write or runtime path | Removed |
| `EpisodePipeline` generation path | `FullStoryPipeline` | Not exported from pipeline barrel; legacy file remains quarantined for deletion/migration cleanup | Quarantined |
| `ImageGenerator` as type container | `images/imageTypes.ts` + `ImageAgentTeam` | Legacy re-export remains for external compatibility; active image generation is service/team driven | Compatibility |
| Image prompt `compare` mode | `llm` default + deterministic fallback | Old env value normalizes to `llm`; production compare diagnostics removed | Removed |
| Legacy flat `encounter.beats` | `encounter.phases[].beats` | Read-only fallback/migration for old stories | Planned |
| `08-final-story.json` as primary story file | `story.json` + `manifest.json` | `08-final-story.json` is still written as a legacy mirror; catalog reads manifest → story.json → legacy fallback | Compatibility |
| `useapi` provider slug | `midapi` | Treat as historical; current provider selection uses `midapi` | Removed from current docs |
| Image-team coordinator scaffolds | Real storyboard-v2 / visual QA path | Keep only if wired into `ImageAgentTeam`/visual checks; otherwise candidate cleanup | Review |

## Prompt Budget Rule

Agents should receive only the compact contract fragments relevant to their
task. Do not paste every framework into every prompt. The goal is to preserve
the old pipeline's wisdom without recreating its prompt weight.
