# Plan 3 — Multi-Scene Branch Zones (Real Alt-Paths)

**Status:** Proposed
**Estimated effort:** ~2 weeks (+ generation time for regression validation)
**Cost impact:** +80–100% per-story API cost
**Companion plans:** [Delayed Consequences](./PLAN_DELAYED_CONSEQUENCES.md), [Post-Episode Flowchart UI](./PLAN_POST_EPISODE_FLOWCHART.md)

## Goal

When a branch opens, players travel through **2–3 scenes unique to their branch** before reconverging at the next bottleneck. The story map actually *looks* branchy, not linear.

## Why this last

Biggest generation cost, deepest pipeline surgery, highest risk of regressions. But it's the only way to make the episode-level scene DAG show genuine alt-paths rather than a line. Worth doing after Plans 1 + 2 have shipped, because those plans make the existing shallow branches *feel* meaningful — which tells you whether Plan 3 is worth the cost bump.

## Prior art

- **The Witcher 3 / Mass Effect 2** — multi-scene arcs between major bottlenecks (e.g. the Bloody Baron questline; ME2's Suicide Mission setup).
- **Dragon Age: Origins** — Origin stories are 2–3 scene dedicated arcs before converging at Ostagar.
- **Detroit: Become Human** — Every chapter has multiple entirely different scene paths that reconverge at chapter end.

## Current constraints that must relax

Identified in the branching audit:

1. **`maxBranchingChoicesPerEpisode` = 2** — keep numerically, but reinterpret as "branch *zones*, not branch *choices*."
2. **`maxScenesPerEpisode` ≈ 6** — raise to 9–10 for branched episodes.
3. **`leadsTo` usually has 1 entry** — architect must emit 2+ for branch-origin scenes.
4. **Encounter aftermath fallback** (`leadsTo[1] || leadsTo[0]`) collapses victory/defeat to the same scene — require distinct targets.
5. **Assembly "rewrite backward" guard** — currently rewrites any out-of-`leadsTo` target back to `leadsTo[0]`. Must allow forward divergence that the architect explicitly planned.
6. **`StoryArchitect` prompt bias** — currently says "Encounters are the primary branching." Rewrite to frame plot-level branches and encounter branches as complementary.

## Implementation steps

### Step 3.1 — Extend `SceneBlueprint` schema

New optional fields on what StoryArchitect emits:

```typescript
interface SceneBlueprint {
  // ...existing
  branchZoneId?: string;            // e.g. "zone-a" — all scenes in an alt-path share this
  branchArcLength?: number;         // how many scenes in this branch arc (2-3)
  reconvergesAt?: string;           // sceneId of the bottleneck where this arc lands
  branchLabel?: string;             // human-readable, e.g. "The Loyal Path"
}
```

**Files:**
- `src/ai-agents/agents/StoryArchitect.ts` — update Zod output schema.
- `src/types/blueprint.ts` (or wherever `SceneBlueprint` lives; locate via `grep`).

### Step 3.2 — Rewrite the StoryArchitect prompt

Required episode shape becomes:

```
bottleneck-1 (shared pearl)
    │
    ▼
branch-decision (scene with branching choice)
    ├──► zone-A: scene-A1 → scene-A2 → [optional scene-A3]
    └──► zone-B: scene-B1 → scene-B2 → [optional scene-B3]
                                     │
                                     ▼
                         bottleneck-2 (reconvergence)
                                     │
                                     ▼
                                  encounter
                                     │
                                     ▼
                                  aftermath
```

**Prompt edits in `src/ai-agents/agents/StoryArchitect.ts`:**

- **Remove** the line "Encounters are ALWAYS bottleneck scenes. They provide agency through skill choices WITHIN the encounter, not through plot branching."
- **Replace** with: "Each episode should contain **at least 1 branch zone** with 2 mutually-exclusive 2-scene arcs that reconverge at the next bottleneck. Encounters provide additional tactical branching *on top of* plot branching."
- **Require**: "Every branch-origin scene must emit `leadsTo` with ≥2 distinct forward targets. Every branch-interior scene emits `leadsTo` with exactly 1 forward target (the next scene in its arc, or the reconvergence bottleneck)."
- **Provide** a canonical JSON example of a branched episode in the prompt.

### Step 3.3 — Update `FullStoryPipeline` wiring

**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

- **~line 4241** (`possibleNextScenes` construction): already uses `leadsTo`. No change needed — will automatically offer multiple targets once architect provides them.
- **~line 4723** (encounter aftermath `victoryNextSceneId` / `defeatNextSceneId`): when `leadsTo.length >= 2`, wire victory → `leadsTo[0]`, defeat → `leadsTo[1]`, each pointing at genuinely different next arcs. Error if `leadsTo.length < 2` for encounter scenes that precede a branch zone.
- **~line 5619** (assembly backward-rewrite): relax so forward-pointing `nextSceneId` values are preserved even if they aren't `leadsTo[0]`. Keep the backward-rewrite only for truly backward references (`targetIdx <= currentIdx`), not for siblings.

### Step 3.4 — Teach `SceneWriter` about branch identity

New context passed to scene generation:

> This scene is part of branch zone **"zone-A"** (the "loyal path").
> Previous scenes in this zone: scene-3 (player chose to trust the duke), scene-4 (player attended the duke's council).
> This zone will reconverge at **scene-7** (the duke's betrayal revealed).
> The sibling zone **"zone-B"** (the "rebel path") is being written separately.
> **Do not reference its events.** The player on this path never experienced them.

**File:** `src/ai-agents/agents/SceneWriter.ts` — extend `branchContext` object and the prompt section that consumes it.

### Step 3.5 — Validator: reject shallow branch zones

**File:** `src/ai-agents/validators/StructuralValidator.ts`

New rules:

1. **Per-zone scene count:** For each distinct `branchZoneId`, count scenes. Require ≥2 per zone. Error if <2.
2. **Minimum zones per episode:** After episode 1, require ≥1 branch zone per episode (warning-level initially, error after 2 weeks of stable generation).
3. **Reconvergence integrity:** Every branch zone's scenes must transitively lead to the same `reconvergesAt` target. Error if a branch zone leaks to a different bottleneck or dead-ends.
4. **Cross-branch leakage:** Run a lightweight check for proper nouns or events from one zone appearing in the other. Warning-level.

### Step 3.6 — Update `branchTopology.ts`

**File:** `src/ai-agents/utils/branchTopology.ts`

Already uses `leadsTo`. Once the architect emits richer `leadsTo` graphs, `analyzeBranchTopology` should auto-detect the 2-scene arcs and their reconvergence point. Verify:

- Correctly identifies 2+ distinct arcs between branch-origin and reconvergence.
- Correctly computes `arcLength` per zone.
- Does not double-count scenes that belong to multiple zones (shouldn't happen, but guard).

### Step 3.7 — Tune generation config

**File:** `src/ai-agents/config.ts` (or equivalent `SCENE_DEFAULTS` location)

```typescript
export const SCENE_DEFAULTS = {
  maxScenesPerEpisode: 10,          // was 6
  minScenesPerEpisode: 4,           // new floor
  branchZonesPerEpisode: { min: 1, max: 2 },      // new
  scenesPerBranchArc: { min: 2, max: 3 },         // new
  maxBranchingChoicesPerEpisode: 2, // unchanged numerically
};
```

Also expose these in `GenerationSettingsConfig` so the UI can override for "shorter/longer" stories.

### Step 3.8 — Image + audio budget

**Files:**
- `src/ai-agents/services/imageGenerationService.ts` — verify no hard caps on scene count that would trip at 10 scenes.
- `src/ai-agents/services/audioGenerationService.ts` — same.
- `src/ai-agents/services/providerThrottle.ts` — throttling holds, but total job duration roughly doubles. Budget alerts in the Generator UI should reflect this.

Per-episode cost roughly doubles. Add a pre-generation warning in `GeneratorScreen.tsx`:

> Branched stories take ~2× longer to generate but produce 2× more distinct content.

### Step 3.9 — Visualizer

**File:** `src/visualizer/storyGraphTransformer.ts`

Already renders `leadsTo` and `Choice.nextSceneId` edges correctly. Once the data is branchy, the viz just works. **No changes needed here** — the [post-episode flowchart UI](./PLAN_POST_EPISODE_FLOWCHART.md) will immediately benefit.

### Step 3.10 — Regenerate + compare

Automated A/B check:

1. Pick a fantasy-template story.
2. Generate with old config (baseline, committed to git).
3. Generate with new config.
4. Compute `distinct nextSceneId targets per episode`. Should go from ~1 to ≥3.
5. Compute `scenes reachable from only one branch` per episode. Should go from 0 to ≥2.

**New test:** `src/ai-agents/pipeline/branchDepth.test.ts` — asserts ≥1 branch zone visible in a generated fantasy sample.

### Step 3.11 — Incremental rollout

Don't flip the switch globally. Add a feature flag:

```typescript
// src/config/featureFlags.ts
branchedEpisodeStructure: { enabled: false, rolloutPercentage: 0 }
```

- Week 1: enabled=true for `fantasy` template only.
- Week 2: add `heist` template.
- Week 3: full rollout if stability holds.

**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts` — gate the new architect prompt behind the flag.

## File change summary

| File | Change |
|---|---|
| `src/ai-agents/agents/StoryArchitect.ts` | Rewrite branching section of prompt; add zone fields to output schema |
| `src/types/blueprint.ts` | Add `branchZoneId`, `branchArcLength`, `reconvergesAt`, `branchLabel` |
| `src/ai-agents/agents/SceneWriter.ts` | Extend `branchContext` with zone identity + isolation instructions |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Encounter aftermath wiring (≥2 leadsTo); relax backward-rewrite; feature flag |
| `src/ai-agents/validators/StructuralValidator.ts` | Add 4 new rules (zone count, zone min, reconvergence integrity, cross-branch leakage) |
| `src/ai-agents/utils/branchTopology.ts` | Verify handling of multi-scene arcs |
| `src/ai-agents/config.ts` | New scene defaults + zone configs |
| `src/config/featureFlags.ts` | **NEW** (if it doesn't exist) |
| `src/ai-agents/pipeline/branchDepth.test.ts` | **NEW** integration test |
| `src/screens/GeneratorScreen.tsx` | Cost warning for branched generation |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM won't respect branch isolation (leaks zone-A events into zone-B) | Explicit isolation instructions in SceneWriter prompt. Step 3.5 rule 4 validator catches leaks. |
| Existing stories become unplayable after schema change | Non-breaking: new fields are optional. Old stories keep working. Engine ignores unset zone metadata. |
| One branch becomes the "canon," the other feels throwaway | Architect prompt requires both zones to have concrete dramatic arcs (`branchLabel`). SceneWriter prompt explicitly says "this is not a filler path." |
| 2× API cost deters users | Feature flag allows opt-in. Generator UI surfaces the cost. Users can choose "shorter, linear" vs "longer, branched." |
| Regression in validation pass rate | Incremental rollout (Step 3.11). Keep the old flag path working. |
| Encounter + branch zone interaction (encounter inside a branch zone?) | Architect prompt specifies: encounters live at bottlenecks (shared convergence points), not mid-branch. Validator enforces. |
| Reconvergence feels contrived | Architect prompt includes examples of *diegetic* reconvergence ("both paths lead to the throne room because both characters must confront the king"). |

## Success criteria

1. A fantasy-template story regenerated post-feature has:
   - ≥1 branch zone per episode (after episode 1).
   - ≥2 scenes per branch arc.
   - ≥3 distinct `nextSceneId` targets per branched episode.
   - 0 cross-branch proper-noun leakage in validator output.
2. Generation time per episode ≤2.2× baseline (acceptable ceiling).
3. `StructuralValidator` pass rate stays ≥85% at full rollout.
4. Post-episode flowchart UI ([Plan 2](./PLAN_POST_EPISODE_FLOWCHART.md)) shows genuinely greyed-out multi-scene paths, not just single-beat sibling branches.
5. Manual playthrough comparison: two playthroughs of the same branched episode share <40% of beat content (vs. currently ~90%).

## Out of scope

- Persistent branch effects across episodes (that's [Plan 1](./PLAN_DELAYED_CONSEQUENCES.md)).
- Player-facing branch picker / preview before choosing (later UX iteration).
- Cross-episode branch zones (zones spanning multiple episodes). Keep zones episode-local for v1.
- Dynamic / procedural branch generation (zones decided at runtime). Architect-authored only.

## Sequencing dependency

**Must ship before Plan 3:** nothing strictly required, but [Plan 2](./PLAN_POST_EPISODE_FLOWCHART.md) pairs best with Plan 3 — the flowchart UI only shines when there's meaningful graph structure to show.

**Must ship after Plan 3 (ideally):** any future work on encounter-inside-branch-zone support, route-based episode divergence, or branch-specific character arcs. Those all build on the zone abstraction this plan introduces.
