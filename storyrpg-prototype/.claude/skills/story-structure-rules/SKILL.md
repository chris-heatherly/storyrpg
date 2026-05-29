---
name: story-structure-rules
description: Use this skill for StoryRPG story-architecture domain rules — the 3-act/7-point season spine, scene-graph blueprints, branch-and-bottleneck patterns, choice taxonomy + density, the stakes triangle, consequence/five-factor budgets, and encounter design. Reach for it when working on StoryArchitect, ChoiceAuthor, BranchManager, EncounterArchitect, SeasonPlannerAgent, or any story-structure types/validators.
---

# Story Structure Rules

The craft contract the generation pipeline authors against. These are the rules agent prompts
enforce and `pipeline-validation` validators protect — change the rule here and the prompt/validator
together, never one in isolation. (This is the *what to author*; `pipeline-agent-development` is the
*how to wire an agent*.)

## 3-Act / 7-Point spine (season level)

Load-bearing: `SourceMaterialAnalyzer` infers it if source material omits it, `SeasonPlannerAgent`
distributes it across episodes, `SevenPointCoverageValidator` enforces it in the retry loop.

**Narrative anchors** — `stakes` (what breaks on failure), `goal` (concrete external goal),
`incitingIncident` (what breaks the status quo), `climax` (the decisive confrontation; MUST match
`sevenPoint.climax`).

**Seven-point structure** — `hook` (ordinary world + core value) → `plotTurn1` (commit to goal;
Act 1/2 wall) → `pinch1` (stakes escalate, allies falter) → `midpoint` (reaction→action; goal
reframed) → `pinch2` (everything nearly lost) → `climax` (matches anchor) → `resolution` (new
equilibrium, core value restated).

**Structural roles** — each `SeasonEpisode.structuralRole` lists the beat(s) it carries:
`hook | plotTurn1 | pinch1 | midpoint | pinch2 | climax | resolution`, plus `rising | falling`
buffer episodes. Distribution from `sevenPointDistribution.ts` is deterministic; the LLM may
override only if the source strongly demands it. Every canonical beat must appear ≥1×, in order.

## Scene graph

**EpisodeBlueprint** carries `arc.<beat>` fields (fill only for beats this episode's
`structuralRole` includes — leave the rest empty; the season carries them elsewhere), `scenes`,
`startingSceneId`, `bottleneckScenes` (all paths pass through), `suggestedFlags/Scores/Tags`, and
`narrativePromises` (setup→payoff). `arc.climax` aligns with the season climax anchor.

**SceneBlueprint** key fields: `purpose: 'bottleneck' | 'branch' | 'transition'`,
`dramaticQuestion`, `wantVsNeed`, `conflictEngine`, `keyBeats`, optional `choicePoint`,
`leadsTo` (navigation), optional `requires` (prerequisites), encounter fields (`isEncounter`,
`encounterType/Difficulty/Buildup/...`), and `incomingChoiceContext` (for branch scenes: what led
here). Scene ids are kebab-case (`scene-market`).

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
