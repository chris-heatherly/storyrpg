---
name: story-structure-rules
description: Use this skill for StoryRPG story-architecture domain rules — the Story Circle season spine, story arcs across acts, scene-graph blueprints, branch-and-bottleneck patterns, choice taxonomy + density, the stakes triangle, consequence/five-factor budgets, and encounter design. Reach for it when working on StoryArchitect, ChoiceAuthor, BranchManager, EncounterArchitect, SeasonPlannerAgent, or any story-structure types/validators.
---

# Story Structure Rules

The craft contract the generation pipeline authors against. These are the rules agent prompts
enforce and `pipeline-validation` validators protect — change the rule here and the prompt/validator
together, never one in isolation. (This is the *what to author*; `pipeline-agent-development` is the
*how to wire an agent*.)

## Story Circle Spine (Season Level)

Story Circle is supreme. `SourceMaterialAnalyzer` infers it if source material omits it,
`SeasonPlannerAgent` distributes it across episodes, and Story Circle coverage validators enforce it
in the retry loop.

**Narrative anchors** — `stakes` (what breaks on failure), `goal` (concrete external goal),
`incitingIncident` (what breaks the status quo), `climax` (the decisive confrontation).

**Story Circle structure** — `you` (ordinary world + starting identity) → `need` (inner/external lack)
→ `go` (crossing the threshold) → `search` (adaptation under pressure) → `find` (discovery or
recontextualization) → `take` (costly acquisition) → `return` (bringing the change home) → `change`
(new equilibrium and identity shift).

**Episode role assignments** — each episode carries one or more Story Circle beats through
`storyCircleRole`: `you | need | go | search | find | take | return | change`. Distribution from
`storyCircleDistribution.ts` is deterministic; the LLM may override only if the source strongly
demands it. Every canonical beat must appear at least once, in order.

## Story Arcs Across Acts

Acts are not a separate structure model. Arcs create pressure bands across acts, with each episode
playing its role in the season-long Story Circle first and then within the arc second.

## Scene graph

**EpisodeBlueprint** carries `arc.<storyCircleBeat>` fields, `scenes`, `startingSceneId`,
`bottleneckScenes` (all paths pass through), `suggestedFlags/Scores/Tags`, and `narrativePromises`
(setup→payoff). The episode's Story Circle role is the primary dramatic brief; arc pressure is
secondary.

**SceneBlueprint** key fields: `purpose: 'bottleneck' | 'branch' | 'transition'`,
`dramaticQuestion`, `wantVsNeed`, `conflictEngine`, `keyBeats`, optional `choicePoint`,
`leadsTo` (navigation), optional `requires` (prerequisites), encounter fields (`isEncounter`,
`encounterType/Difficulty/Buildup/...`), and `incomingChoiceContext` (for branch scenes: what led
here). Scene ids are kebab-case (`scene-market`).

## Scene-first planning (season level, default-on)

Default flow is Story Circle-first: `SeasonPlannerAgent` assigns each episode one or more Story Circle roles, then
`SeasonPlannerAgent` also builds a season-level scene spine. Scene-first planning is ON by default
and opt-out via `SCENE_FIRST_PLANNING=0`; do not describe it as a `sceneEpisode`-only mode.

- **Altitude cascade**: season owns the Story Circle spine; each **episode maps to Story Circle roles**
  (`storyCircleRole`); each **scene serves** the purpose its episode's role names
  (`PlannedScene.dramaticPurpose`); **beats serve the scene** and are still generated later, per
  episode. Scenes do NOT carry a competing season-structure label.
- **`SeasonScenePlan`** (`src/types/scenePlan.ts`) lives on `SeasonPlan.scenePlan`; each episode's
  slice is `SeasonEpisode.plannedScenes`. Built by `seasonScenePlanBuilder.ts`, then optionally
  upgraded by `SeasonPlannerAgent.authorScenePlanLLM` for non-treatment runs.
- **Encounters are a kind of scene**: a `PlannedScene` with `kind: 'encounter'` carrying
  `PlannedSceneEncounter`. The scene id IS the encounter id. No parallel encounter list — anything
  that reasons over scenes (pacing, the consequence/branch budget) sees encounters by construction.
- **Setup/payoff graph**: `PlannedScene.setsUp` / `paysOff` + `SeasonScenePlan.setupPayoffEdges`
  make cross-scene relationships explicit and checkable (must point forward in time). Derived from
  consequence chains, choice moments, and the information ledger. `SceneSpineValidator` enforces it.
- **StoryArchitect elaborate-mode**: when `seasonPlanDirectives.plannedScenes` is present, it
  elaborates those scenes into the blueprint (no LLM invention) and routes through the SAME repair
  pipeline. Encounter-kind scenes feed the existing `isEncounter`/`encounterType` dispatch.
- Planned scenes can carry `coldOpenProfile` and `sceneConstructionProfile` obligations; the
  downstream path binds those into required-beat and scene-turn guidance.

## Branch-and-bottleneck

- **Bottlenecks**: everyone hits them regardless of prior choices — encounters, revelations,
  emotional peaks. ~2-3 per episode, reachable from ALL branches. Encounters are always bottlenecks.
- **Branches**: choices lead to different experiences, then **reconverge at the next bottleneck**.
  Each branch feels meaningfully different; state changes must reconcile at reconvergence.
- **Hard rules**: no dead ends (every scene `leadsTo` somewhere), no orphan branches (all reconverge),
  no unreachable scenes (all reachable from `startingSceneId`), no infinite loops (cycle-detected),
  state consistency at bottlenecks, every bottleneck reachable from every valid path.
- **Reconvergence prose** uses conditional `setupTextVariants` keyed on flags/scores so a merged
  scene acknowledges the path taken (`flag:chose_stealth` vs `flag:chose_combat`).

## Choice taxonomy

| Type | Target | Branches? | Key rule |
|---|---|---|---|
| `expression` | ~35% | **NEVER** | Personality/voice. Sets flags for callbacks. No `nextSceneId`. |
| `relationship` | ~30% | may | NPC bond. ≥1 relationship consequence. |
| `strategic` | ~20% | may | Skill/stat-based. `statCheck` on ≥1 option. |
| `dilemma` | ~15% | may | Value test, no right answer. `statCheck`; should set tint flags. |

- Branching is a **property** (`branches: true` on `choicePoint`), not a type. Max 1-2 branching
  choice points per episode — encounter outcomes are the primary branch source.
- **Density**: ≥50% of scenes have a `choicePoint`; the first scene must; never >2 consecutive scenes
  without one; first choice within ~60s; average gap ≤90s.
- **Choice** fields: `text` (5-15 words), `choiceType`, `consequences`, `nextSceneId` (branching
  only), `statCheck` (required for relationship/strategic/dilemma), `outcomeTexts`
  (success/partial/failure, required), `reactionText` (required for non-branching), `tintFlag`
  (non-branching, sets `tint:xxx`), `stakesAnnotation`, `conditions`, `showWhenLocked`/`lockedText`.

**Stakes triangle** — every `choicePoint` defines all three: **Want** (trying to achieve), **Cost**
(risk/sacrifice), **Identity** (what it says about who they are).

## Consequences

| Type | Format | Use |
|---|---|---|
| `setFlag` | `{ flag, value }` | Boolean state; `tint:xxx` prefix for dilemma tints |
| `changeScore` | `{ score, change }` | Numeric values |
| `addTag`/`removeTag` | `{ tag }` | Identity markers |
| `relationship` | `{ npcId, dimension, change }` | trust/affection/respect/fear |
| `attribute` | `{ ... }` | Core stats (rare) |

**Five-factor test** — every non-`expression` choice affects ≥1 of: Outcome, Process, Information,
Relationship, Identity. Major choices affect ≥3 of 5.

**Delayed consequences** (butterfly effect): `{ consequence, description, delay: {type:'scenes'|'episodes', count}, triggerCondition? }`. Use sparingly — 1-2 per episode.

## Season choice/consequence budgets (scene-first, opt-in)

When scene-first planning is on, the season layers a **weighted "dramatic diet"** over its scene plan
*before episodes generate*. Budget the spine, not the texture: the budgeted unit is ONE central choice
per choice-bearing scene OR per encounter; tactical choices inside an encounter are not budgeted.

- **Weighting**: a scene choice weighs `SCENE_BUDGET_WEIGHT` (1); an encounter weighs
  `ENCOUNTER_BUDGET_WEIGHT` (3) — a concentrated serving of ONE role. All mixes are weighted.
- **Choice-type target** (weighted): expression 35 / relationship 30 / strategic 20 / dilemma 15.
  Encounters carry exactly one **non-expression** role (`relationship`|`strategic`|`dilemma`) — never
  `expression` (encounters are stakes-driven). Standard scenes may be any of the four.
- **Consequence-tier target** (unified, encounters included): callback 50 / tint 25 / branchlet 17 /
  branch 8. Invariants: `expression` ⇒ `callback`; `dilemma` ⇒ ≥ `branchlet`; **any encounter ⇒
  ≥ `branchlet`** (never a bare `callback`, branch-point or not).
- **Allocation** is consequential-first at plan time: encounters claim their non-expression /
  branch-heavy slots first, so standard scenes auto-absorb expression and relationship and lighter
  tiers. Authored `choiceType`/`consequenceTier` are honored where they don't break an invariant;
  reconciliation toward target is one gentle pass (authored-drama-wins). See
  `seasonBudgetAllocator.ts` (`buildBudgetUnits` / `allocateChoiceTypes` / `allocateConsequenceTiers`).
- **Validation**: `SeasonBudgetValidator` checks both weighted mixes against target within
  `BUDGET_TOLERANCE` (warn 15 / error 25 pts per type/tier) plus the hard invariants, after allocation
  and before the plan is finalized. Advisory by default; hard-gates only under
  `GATE_SEASON_BUDGETS=1` (default-off).

## Encounter design

Types: `combat | chase | stealth | social | puzzle | exploration | mixed` (social is the versatile
default for literary/romantic/gothic).

- **Encounter-first**: the encounter IS the episode; everything else is setup. Placed at the dramatic
  peak (~scene 3-5, two-thirds through), 2-3 setup scenes before, 1-2 consequence scenes after.
- **Structure**: 3-5 `beats`, a `goalClock` (6 segments) + `threatClock` (4-6), `stakes`
  (victory/defeat), `storylets` (victory/partialVictory/defeat/escape), environmental elements,
  npcStates, escalationTriggers, informationVisibility.
- **Branching tree, not linear**: each outcome (success/complicated/failure) holds a `nextSituation`
  with embedded choices. Max 3-4 layers; terminals set `isTerminal: true, encounterOutcome`.
- **Prior-state payoff**: `setupTextVariants`, conditional choices (`conditions` +
  `showWhenLocked`/`lockedText`), and `statBonus` (difficulty reduction) reward earlier choices.
- **Storylets (aftermath)**: Victory 2 beats (+confidence/skill), Defeat 3 beats
  (+setbacks/resolve/skill-developing), Escape 2 beats (+resourcefulness).

## See also

- `pipeline-validation` — the validators that enforce these rules (severity, auto-fix, retry loop).
- `pipeline-agent-development` — how the agents that author this structure are wired.
- `docs/STORY_QUALITY_CONTRACT.md` and `src/ai-agents/prompts/storyQualityContract.ts` — the "why"
  behind these rules (fiction-first, agency, callbacks, mechanical reactivity).
- The richer Cursor twin lives at `.cursor/skills/story-structure-rules/`; keep the two in sync.
