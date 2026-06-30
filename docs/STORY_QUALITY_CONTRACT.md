# Story Quality Contract

**Status:** Active rule contract for the current `FullStoryPipeline`.
**Last updated:** May 25, 2026

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
- **Choice-type mix:** expression, relationship, strategic, and dilemma
  percentages are baseline diagnostics, not a universal quality contract.
  Treatment intent, season structure, and Story Circle episode role may justify
  deliberate skew when choices still serve the authored pressure.
- **Convergent spine:** branches create different experiences between
  bottlenecks, then reconverge at planned anchors without erasing residue.
- **Delayed memory:** important choices should echo later through conditional
  text, NPC recognition, altered descriptions, relationship tone, visual state,
  or later choice wording.
- **Mechanical storytelling:** choices should leave fiction-visible residue
  through story verbs, affordance sources, witness reactions, and playable
  failure residue rather than invisible stat bookkeeping.
- **Skill surfaces:** hidden skills must matter through fiction-first surfaces:
  passive insights, prepared advantages, choice affordances, outcome texture,
  and branch residue. Hard checks should usually have at least two surfaces.
- **Pixar-style craft:** clear desire, escalating pressure, earned surprise,
  setup/payoff, causality, character change under pressure, and emotional
  payoff. This is a rubric, not a separate agent or rigid formula.

### Skill Surface Contract

- **Passive insight:** beat-level `skillInsights` reveal danger, opportunity,
  emotional subtext, contradictions, environmental tools, social leverage, or
  hidden costs when hidden skill coverage meets the threshold.
- **Prepared advantage:** `statCheck.modifiers` apply hidden deltas from prior
  flags, relationships, items, clues, promises, injuries, mentorship, or branch
  residue. The optional `hint` must be prose, not mechanics.
- **Playable failure:** every stat-check failure should create story material:
  debt, suspicion, injury, lost leverage, exposure, damaged trust, route
  pressure, recovery, or a later callback.
- **Banned player-facing terms:** stat, skill check, DC, threshold, roll,
  modifier, bonus, success chance, failure chance, percentage, level
  requirement, and build.

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
| Stat-check balance | `StatCheckBalanceValidator` |
| Skill surfaces | `SkillSurfaceValidator` |
| Skill / attribute coverage | `SkillCoverageValidator` |
| Branch mechanical residue | `BranchMechanicalDivergenceValidator` |
| Mechanical storytelling metadata | `MechanicalStorytellingValidator`, story verb helpers |
| Callback ledger hygiene | `CallbackCoverageValidator` |
| Callback opportunity density | `CallbackOpportunitiesValidator` (advisory only) |
| Planned choice residue | `ResidueObligationValidator`, `CallbackLedger`, `choiceMemoryDebt` |
| Consequence budget | `ConsequenceBudgetValidator` |
| Choice-type mix telemetry | `ChoiceDistributionValidator` |
| Branch graph validity | `SceneGraphBranchValidator`, `DivergenceValidator` |
| Setup/payoff | `SetupPayoffValidator` |
| Twist / earned surprise | `TwistQualityValidator`, `PixarPrinciplesValidator` |
| Character change | `ArcDeltaValidator`, `SceneCraftValidator` |
| Visual defects | storyboard-v2 QA, `imageDefectGate`, visual validators |
| Provider refs | `referencePackBuilder`, `referenceStrategy`, `providerCapabilities` |
| Treatment/source fidelity | `TreatmentFidelityValidator`, quote recall diagnostics |
| Sequence specificity/continuity | `sequencePlanSpecificityAudit`, `sequenceContinuityAudit`, `turnAudit` |

## Blocking vs Advisory (validator tiering)

The #1 product goal is shipping complete, playable stories. Craft/fidelity
validators must NOT produce zero output when they can't be fully satisfied.
StoryArchitect retries on any validation failure, but on the **final** attempt
the outcome depends on the failure tier:

| Tier | Examples | Final-attempt behavior |
|---|---|---|
| **Hard correctness** | scene-graph references a non-existent scene, bottleneck/starting scene invalid, choice-density floor unmet, required encounter missing, unparseable JSON, `[DramaticStructure]`, `[SceneTurnContract]` | **Blocks after the bounded architecture retry / deterministic repair path** — the episode fails when a scene has no real question, turn, changed state, entry intent, obstacle, consequence, or removability. |
| **Advisory craft/fidelity** | `[TreatmentFidelity]`, `[ThemePressure]`, `[EpisodePressure]` | **Degrades to a recorded warning** — the blueprint still ships; warnings are emitted as pipeline `warning` events and surfaced on the run, not discarded. |

`[DramaticStructure]` and `[SceneTurnContract]` are now narrow scene-shape
correctness gates, not broad taste rubrics. Scene-first blueprints receive
deterministic scene contracts before validation, and both invented and
planned-scene paths use the same architecture gate policy. The defaults can be
reversed per environment with `GATE_DRAMATIC_STRUCTURE=0` or
`GATE_SCENE_TURN_CONTRACT=0`.

Classification lives in `StoryArchitect.classifyBlueprintFailure()` (pure,
unit-tested). Hard-error keyword checks run only on non-advisory lines so an
advisory message that incidentally mentions a hard keyword (e.g. TreatmentFidelity's
"…into a real choicePoint") is not misread as hard. See
`docs/PROJECT_AUDIT_2026-05-28.md` (Track B1).

## Quality Score Bands & Ledger

The best-practices validator computes a 0-100 `overallScore` per run. Bands
(defined in `src/ai-agents/utils/qualityLedger.ts`):

| Band | Score | Meaning |
|---|---|---|
| **ship** | ≥ 70 | Good to publish. |
| **warn** | 50–69 | Publishable but flagged for review. |
| **block** | < 50 | Needs rework. |

Every run appends one JSONL row to `generated-stories/quality-ledger.jsonl`
(`outcome`, `overallScore`, `band`, `qaScore`, `validationPassed`,
`finalStoryContractPassed`, `errorCount`, timestamps). This makes the
generation success/failure rate and quality trend trackable over time rather
than invisible in the filesystem. See `docs/PROJECT_AUDIT_2026-05-28.md` (B3).

## Deprecated Structure Boundary

| Deprecated / Legacy Item | Replacement | Compatibility Policy | Status |
|---|---|---|---|
| `ParallelStoryPipeline` | `FullStoryPipeline` | No write or runtime path | Removed |
| `EpisodePipeline` generation path | `FullStoryPipeline` | No write or runtime path | Removed |
| `ImageGenerator` as type container | `images/imageTypes.ts` + `ImageAgentTeam` | Active image generation is service/team driven | Removed |
| Image prompt `compare` mode | `llm` default + deterministic fallback | Old env value normalizes to `llm`; production compare diagnostics removed | Removed |
| Legacy flat `encounter.beats` | `encounter.phases[].beats` | Read-only fallback/migration for old stories | Planned |
| `08-final-story.json` as primary story file | `story.json` + `manifest.json` | Migration input only; new runtime writes and catalog reads use modern package files | Migration only |
| `useapi` provider slug | `midapi` | Treat as historical; current provider selection uses `midapi` | Removed from current docs |
| Image-team coordinator scaffolds | Real storyboard-v2 / visual QA path | Keep only if wired into `ImageAgentTeam`/visual checks; otherwise candidate cleanup | Review |

## Prompt Budget Rule

Agents should receive only the compact contract fragments relevant to their
task. Do not paste every framework into every prompt. The goal is to preserve
the old pipeline's wisdom without recreating its prompt weight.
