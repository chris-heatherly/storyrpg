# Mechanical Storytelling Reactivity Plan

**Status:** Proposed implementation plan  
**Last Updated:** May 19, 2026  
**Primary Goal:** Increase perceived story reactivity without increasing the structural branch cap.

---

## 1. Overview

StoryRPG already has most of the machinery needed for richer mechanical
storytelling:

- Hidden player state: attributes, skills, identity, relationships, flags,
  scores, tags, and inventory.
- Fiction-first choice handling through `Choice`, `ConditionExpression`,
  `Consequence`, `outcomeTexts`, `reactionText`, and `tintFlag`.
- Delayed memory through `residueHints`, `memorableMoment`, `CallbackLedger`,
  `textVariants`, and callback validators.
- Branch-and-bottleneck structure with a default cap of 2 branching choice
  points per episode.
- Encounters that can provide tactical branching while reconverging afterward.

The missing layer is not more permanent branches. The missing layer is a
stronger contract that turns hidden state into visible fiction:

> A meaningful choice should change what the world permits, what an NPC
> believes, how future choices read, or what failure creates.

This plan adds that layer through four main upgrades:

1. Genre/story verbs that make choices feel specific to the world.
2. State-to-affordance metadata that explains why an option exists.
3. Witness reactions that make NPCs feel like moral observers.
4. Failure residue that makes failed checks produce playable story material.

All additions are optional and backward compatible. Existing generated stories
must continue loading unchanged.

---

## 2. Current Codebase Baseline

### Existing Runtime and Data Model

Relevant current files:

- `storyrpg-prototype/src/types/choice.ts`
- `storyrpg-prototype/src/types/conditions.ts`
- `storyrpg-prototype/src/types/consequences.ts`
- `storyrpg-prototype/src/types/player.ts`
- `storyrpg-prototype/src/engine/storyEngine.ts`

Current `Choice` already supports:

- `choiceType`
- `choiceIntent`
- `impactFactors`
- `consequenceTier`
- `stakes`
- `conditions`
- `showWhenLocked`
- `lockedText`
- `statCheck`
- `consequenceDomain`
- `reminderPlan`
- `feedbackCue`
- `moralContract`
- `residueHints`
- `visualResidueHint`
- `consequences`
- `delayedConsequences`
- `nextSceneId`
- `nextBeatId`
- `outcomeTexts`
- `reactionText`
- `tintFlag`
- `memorableMoment`

The new work should build on those fields instead of replacing them.

### Existing Generation Support

Relevant current files:

- `storyrpg-prototype/src/ai-agents/agents/ChoiceAuthor.ts`
- `storyrpg-prototype/src/ai-agents/agents/EncounterArchitect.ts`
- `storyrpg-prototype/src/ai-agents/agents/SceneWriter.ts`
- `storyrpg-prototype/src/ai-agents/prompts/storyQualityContract.ts`
- `storyrpg-prototype/src/ai-agents/prompts/callbackPromptSection.ts`
- `storyrpg-prototype/src/ai-agents/pipeline/FullStoryPipeline.ts`

Current `ChoiceAuthor` already:

- Treats branching as a property of choices, not a choice type.
- Uses `maxBranchingChoicesPerEpisode`, defaulting to 2.
- Requires meaningful non-expression choices to include `residueHints`.
- Adds an advisory fallback `residueHints` entry when one is missing.
- Prompts for `outcomeTexts`, `reactionText`, `tintFlag`, `moralContract`,
  `reminderPlan`, `feedbackCue`, and `memorableMoment`.
- Supports identity-gated choices through existing conditions.

### Existing Validation and Diagnostics

Relevant current files:

- `storyrpg-prototype/src/ai-agents/validators/ChoiceImpactValidator.ts`
- `storyrpg-prototype/src/ai-agents/validators/CallbackCoverageValidator.ts`
- `storyrpg-prototype/src/ai-agents/validators/CallbackOpportunitiesValidator.ts`
- `storyrpg-prototype/src/ai-agents/validators/IntegratedBestPracticesValidator.ts`
- `storyrpg-prototype/src/visualizer/choiceSystemAnalyzer.ts`
- `storyrpg-prototype/src/visualizer/residueGraphExpander.ts`

Current validation already checks:

- Expression/flavor choices do not branch.
- Meaningful choices declare impact factors.
- Branching/dilemma choices have stakes metadata.
- Non-callback consequence tiers have durable impact.
- Callback hooks are harvested and paid off across episodes.

The new validation should extend this surface rather than create a parallel
quality framework.

---

## 3. Design Principles

### Keep Branch Caps Stable

Do not raise `maxBranchingChoicesPerEpisode` for this work.

The goal is to make the current branch budget feel deeper through:

- conditional text
- altered choice availability
- altered choice wording
- callbacks
- witness reactions
- relationship behavior
- failure consequences
- encounter advantages or complications
- visual staging hints
- recap language

### Preserve Fiction-First Presentation

Never expose:

- raw stats
- dice rolls
- percentages
- thresholds
- hidden scores
- build optimization language

Mechanics should appear as:

- risk
- leverage
- preparation
- memory
- trust
- suspicion
- fear
- obligation
- social pressure
- environmental opportunity

### Prefer Micro-Reactivity Over Structural Expansion

Permanent branches are expensive. Most perceived reactivity should come from
small authored acknowledgements:

- "Mara does not look at the knife. She looks at you."
- "The guard recognizes the seal you stole earlier."
- "The merciful answer rises before the practical one."
- "Because you lied before, this truth lands badly."

### Make Failure Playable

Failure should not mean "same scene, worse prose." Failure should create new
story material:

- debt
- suspicion
- injury
- lost leverage
- exposure
- obligation
- damaged trust
- position shift
- unwanted witness
- altered access

---

## 4. Public API and Type Changes

All new fields are optional. No migration is required for existing stories.

### 4.1 Choice Story Verb

Add to `Choice` in `storyrpg-prototype/src/types/choice.ts`:

```ts
storyVerb?: string;
```

Purpose:

- Identifies the world-specific action verb behind the option.
- Helps validators and visualizers see whether generated choices are using
  genre-specific verbs instead of generic action.
- Does not need runtime behavior in v1.

Examples:

- `bribe`
- `forge`
- `confess`
- `invoke`
- `sabotage`
- `tail`
- `parley`
- `blackmail`
- `commune`
- `exhume`

Player-facing choice text should still be natural prose. The verb is metadata.

### 4.2 Affordance Source

Add to `Choice`:

```ts
export type ChoiceAffordanceSource =
  | 'identity'
  | 'relationship'
  | 'tag'
  | 'item'
  | 'skill'
  | 'flag'
  | 'callback';

affordanceSource?: ChoiceAffordanceSource;
```

Purpose:

- Explains what kind of prior state made an option available, locked, or
  meaningfully distinct.
- Supports validation of state-to-affordance density.
- Supports future visualizer/readout improvements.

Expected pairings:

| Source | Usually Paired With |
|---|---|
| `identity` | `conditions.type === 'identity'`, identity-tag residue, voice-specific choice text |
| `relationship` | relationship condition, relationship consequence, witness reaction |
| `tag` | tag condition, tag consequence, callback residue |
| `item` | item condition, item consumption, bypass or leverage |
| `skill` | stat check or locked option |
| `flag` | flag condition or prior event callback |
| `callback` | unresolved callback hook, `memorableMoment`, or callback text variant |

### 4.3 Witness Reactions

Add exported type:

```ts
export type WitnessReactionStance =
  | 'approves'
  | 'disapproves'
  | 'fears'
  | 'admires'
  | 'questions'
  | 'remembers';

export interface WitnessReaction {
  npcId: string;
  stance: WitnessReactionStance;
  reactionText: string;
  residueHint?: string;
}
```

Add to `Choice`:

```ts
witnessReactions?: WitnessReaction[];
```

Purpose:

- Captures how named NPCs interpret the player's action.
- Makes relationships feel like active social memory rather than only hidden
  meters.
- Gives `SceneWriter`, callbacks, visualizer tools, and future UI surfaces a
  structured source for NPC acknowledgement.

Rules:

- `npcId` must reference an NPC in the story, preferably one in the current
  scene.
- `reactionText` must be fiction-first and player-facing safe.
- Witness reactions should be used when NPCs observe choices involving:
  loyalty, mercy, violence, deception, fear, trust, leadership, betrayal, or
  sacrifice.
- Do not duplicate every relationship consequence. Use reactions for moments
  the player should feel socially interpreted.

Example:

```json
{
  "witnessReactions": [
    {
      "npcId": "mara",
      "stance": "questions",
      "reactionText": "Mara hears the mercy in your answer, but not the certainty.",
      "residueHint": "Mara later presses the player on whether mercy is courage or avoidance."
    }
  ]
}
```

### 4.4 Failure Residue

Add exported type:

```ts
export type FailureResidueKind =
  | 'debt'
  | 'suspicion'
  | 'injury'
  | 'lost_leverage'
  | 'exposure'
  | 'obligation'
  | 'damaged_trust'
  | 'position_shift';

export interface FailureResidue {
  kind: FailureResidueKind;
  description: string;
}
```

Add to `Choice`:

```ts
failureResidue?: FailureResidue;
```

Purpose:

- Makes failed stat checks produce durable fiction.
- Gives validators a deterministic way to detect whether failure is playable.
- Gives later agents a compact description of what failure changed.

Rules:

- Required for important stat-check choices unless failure already creates
  durable consequences, delayed consequences, route impact, or a clear
  complication in `outcomeTexts.failure`.
- Should usually be paired with at least one of:
  - `consequences`
  - `delayedConsequences`
  - `residueHints`
  - `memorableMoment`
  - `witnessReactions`
  - `reactionText`

Example:

```json
{
  "failureResidue": {
    "kind": "suspicion",
    "description": "The guard lets the player pass, but now believes the papers are false."
  }
}
```

---

## 5. Generation Changes

### 5.1 Mechanical Storytelling Prompt Contract

Update `storyrpg-prototype/src/ai-agents/prompts/storyQualityContract.ts`.

Add a new compact prompt fragment:

```ts
export const STORY_QUALITY_MECHANICAL_REACTIVITY = `
## Mechanical Storytelling Reactivity
- A meaningful choice should change what the world permits, what an NPC believes, how future choices read, or what failure creates.
- Prefer micro-reactivity over extra branches: callbacks, residue, scene tints, witness comments, altered prose, relationship tone, locked/unlocked options, and visual staging.
- Hidden state should surface as affordance: prior mercy, trust, items, tags, skills, promises, lies, and callback hooks should open, color, or close options.
- Failure should create playable story material: debt, suspicion, injury, lost leverage, exposure, obligation, damaged trust, or changed position.
- Use genre-specific story verbs so choices feel native to the world, not generic.
`;
```

Add `'mechanicalReactivity'` to `buildStoryQualityContractSection`.

Use this section in prompts for:

- `ChoiceAuthor`
- `EncounterArchitect`
- `SceneWriter` where callback or variant authoring is relevant

### 5.2 Derive Story Verbs

Add story verb derivation during planning or early generation.

Recommended owner:

- `SeasonPlannerAgent` if verbs should apply across the full season.
- `StoryArchitect` if verbs should be episode/scene-specific.
- A small pure helper if both agents need it.

Recommended helper:

```ts
export interface StoryVerb {
  verb: string;
  description: string;
  typicalSources: Array<'identity' | 'relationship' | 'tag' | 'item' | 'skill' | 'flag' | 'callback'>;
  consequenceDomains: ConsequenceDomain[];
}

export function deriveStoryVerbs(input: {
  genre: string;
  tone?: string;
  sourceSummary?: string;
  worldContext?: string;
}): StoryVerb[];
```

Initial implementation can be heuristic and genre-based. LLM-derived verbs can
be added later if useful.

Example verb sets:

| Genre | Verbs |
|---|---|
| Heist | case, forge, tail, bribe, distract, crack, plant, lift, launder, double-cross |
| Gothic | confess, trespass, invoke, conceal, commune, exhume, absolve, bind, haunt |
| Fantasy | parley, swear, invoke, track, scout, duel, bargain, consecrate, sabotage |
| Thriller | tail, pressure, expose, misdirect, surveil, leak, coerce, vanish |
| Court intrigue | flatter, blackmail, petition, duel, expose, pledge, betray, broker |

Pass derived verbs into:

- `ChoiceAuthorInput`
- `EncounterArchitectInput`

Add optional input field:

```ts
storyVerbs?: StoryVerb[];
```

### 5.3 Update ChoiceAuthor

File:

- `storyrpg-prototype/src/ai-agents/agents/ChoiceAuthor.ts`

Prompt changes:

- Include available `storyVerbs`.
- Require meaningful choices to choose a `storyVerb` when a verb fits.
- Require `affordanceSource` when a choice uses `conditions`,
  `showWhenLocked`, `lockedText`, callback hooks, or prior-state framing.
- Prompt for `witnessReactions` when named NPCs observe a moral, relational,
  deceptive, violent, or loyalty-testing choice.
- Prompt for `failureResidue` on stat-check choices where failure changes the
  situation.

Required JSON structure additions:

```json
{
  "storyVerb": "bribe",
  "affordanceSource": "relationship",
  "witnessReactions": [
    {
      "npcId": "mara",
      "stance": "disapproves",
      "reactionText": "Mara goes quiet when she sees how easily you spend the truth.",
      "residueHint": "Mara later hesitates before trusting the player's account."
    }
  ],
  "failureResidue": {
    "kind": "lost_leverage",
    "description": "The contact keeps the payment but no longer believes the player controls the room."
  }
}
```

Validation/fallback inside `ChoiceAuthor.validateChoices`:

- Do not auto-create witness reactions; bad invented NPC references are worse
  than absence.
- Do not auto-create `failureResidue` unless there is enough local signal from
  `outcomeTexts.failure`, `reminderPlan`, or `feedbackCue`.
- If a meaningful choice has no `storyVerb`, allow it but warn.
- If a choice has `conditions` but no `affordanceSource`, infer a source from
  the condition type when possible.

Inference mapping:

| Condition Type | Inferred Affordance Source |
|---|---|
| `identity` | `identity` |
| `relationship` | `relationship` |
| `tag` | `tag` |
| `item` | `item` |
| `skill` / `attribute` | `skill` |
| `flag` / `score` | `flag` |

### 5.4 Update EncounterArchitect

File:

- `storyrpg-prototype/src/ai-agents/agents/EncounterArchitect.ts`

Changes:

- Accept `storyVerbs`.
- Use verbs to diversify encounter actions and approaches.
- Make failed encounter outcomes create `FailureResidue`-like story residue
  where compatible with existing encounter types.
- Prefer existing encounter concepts for runtime behavior:
  - complications
  - threat clock
  - encounter advantage
  - encounter complication
  - aftermath storylets

Do not add a separate encounter runtime system in v1 unless current encounter
types require it. The first pass can be prompt and validation driven.

### 5.5 Update SceneWriter Callback Usage

Files:

- `storyrpg-prototype/src/ai-agents/agents/SceneWriter.ts`
- `storyrpg-prototype/src/ai-agents/prompts/callbackPromptSection.ts`

Current callback prompting asks for text variants that pay off prior hooks.
Keep that behavior and expand the acceptable payoff forms:

- NPC aside
- altered scene description
- changed choice wording
- environmental echo
- relationship tone
- visual staging hint
- reputation mention
- locked/unlocked affordance

Do not force callbacks into unrelated scenes. The prompt should still say to
keep them natural.

Suggested prompt wording:

```text
Payoffs do not need to be plot branches. Prefer small acknowledgements:
NPC asides, altered descriptions, changed choice wording, colder/warmer
relationship tone, reputation mentions, environmental evidence, or visual
staging. The player should feel remembered without seeing the machinery.
```

---

## 6. Validation Changes

### 6.1 Extend ChoiceImpactValidator or Add MechanicalStorytellingValidator

Recommended approach:

- Keep `ChoiceImpactValidator` focused on existing contract.
- Add a new `MechanicalStorytellingValidator` for the new reactivity rules.
- Register it in `IntegratedBestPracticesValidator`.

File:

- `storyrpg-prototype/src/ai-agents/validators/MechanicalStorytellingValidator.ts`

Suggested input:

```ts
export interface MechanicalStorytellingInput {
  storyNpcs?: Array<{ id: string }>;
  sceneNpcIdsBySceneId?: Record<string, string[]>;
  choices: Array<Choice & { sceneId?: string; beatId?: string }>;
}
```

Suggested metrics:

```ts
export interface MechanicalStorytellingMetrics {
  totalChoices: number;
  meaningfulChoices: number;
  choicesWithStoryVerb: number;
  choicesWithAffordanceSource: number;
  choicesWithWitnessReactions: number;
  statChecksWithPlayableFailure: number;
  invalidWitnessReferences: number;
}
```

### 6.2 Validation Rules

#### Rule 1: Meaningful Choices Need Reactive Surface

For every non-expression/non-flavor choice, require at least one:

- `residueHints`
- `memorableMoment`
- `witnessReactions`
- `conditions`
- `affordanceSource`
- `consequences`
- `delayedConsequences`
- `nextSceneId`
- `tintFlag`
- `reactionText`
- `outcomeTexts`

Current `ChoiceAuthor` already requires `residueHints`, so this rule should
mostly catch old fixtures, malformed generated output, or external story data.

#### Rule 2: Gated Choices Should Explain the Affordance

If a choice has `conditions`, `showWhenLocked`, or `lockedText`, then it should
have either:

- `affordanceSource`, or
- a condition type that can be inferred.

Validator should warn, not error.

#### Rule 3: Witness Reactions Must Reference Valid NPCs

For every `witnessReactions[]` entry:

- `npcId` must exist in `story.npcs`.
- If `sceneNpcIdsBySceneId` is available, warn when the NPC is not in the
  current scene.
- `reactionText` must be non-empty.

Invalid story NPC references should be errors. Off-scene witnesses should be
warnings unless the story context explicitly allows it.

#### Rule 4: Stat-Check Failure Must Be Playable

For every choice with `statCheck`, consider failure playable if at least one is
true:

- `failureResidue` exists with non-empty description.
- `outcomeTexts.failure` contains complication language.
- `delayedConsequences` exists.
- `consequences` exists.
- `residueHints` includes `later_text_variant`,
  `relationship_behavior`, `encounter_complication`, or `recap_summary`.
- `memorableMoment` exists.
- `nextSceneId` exists.

Complication language heuristic can search for terms like:

- debt
- suspicion
- injury
- exposed
- leverage
- obligation
- trust
- alarm
- cost
- caught
- marked
- consequence
- complication

This heuristic is a backstop. Prefer `failureResidue`.

#### Rule 5: Story Verbs Should Appear in Important Choice Sets

Warn when:

- A meaningful non-expression choice has no `storyVerb`.
- An episode has story verbs available but none appear in meaningful choices.

Do not error. Some valid choices are emotional or relational and may not need a
clean verb label.

### 6.3 Integrated Validation

Register the new validator in:

- `storyrpg-prototype/src/ai-agents/validators/index.ts`
- `storyrpg-prototype/src/ai-agents/validators/IntegratedBestPracticesValidator.ts`

Add output category:

- `mechanical_storytelling`

Validation levels:

| Issue | Level |
|---|---|
| Invalid witness NPC id | error |
| Empty witness reaction text | warning |
| Stat-check failure with no playable failure signal | warning |
| Meaningful choice with no reactive surface | warning |
| Conditioned choice with no affordance source | suggestion |
| Missing story verb | suggestion |

---

## 7. Visualizer and Diagnostics

Relevant files:

- `storyrpg-prototype/src/visualizer/choiceSystemAnalyzer.ts`
- `storyrpg-prototype/src/visualizer/residueGraphExpander.ts`

### 7.1 Choice Summary

Extend choice summaries to include:

- `storyVerb`
- `affordanceSource`
- witness reaction count
- failure residue kind

These should appear in author/debug views, not necessarily player-facing
summaries.

### 7.2 Facets

Add or reuse facets for:

- `affordance`
- `witness`
- `failure-residue`
- `story-verb`

This makes the visualizer useful for answering:

- Which choices are build/state-gated?
- Which NPCs are witnessing player identity?
- Which failures create future story?
- Are choices too generic for the genre?

---

## 8. Runtime Behavior

No new reader UI is required for v1.

Runtime should continue to:

- filter choices with `conditions`
- show locked choices with `showWhenLocked` and `lockedText`
- resolve stat checks through `resolveStatCheck`
- apply consequences through existing game store flow
- select `outcomeTexts` by resolution tier
- route through `nextSceneId` / `nextBeatId`

The new fields are primarily for:

- generation quality
- validation
- callback planning
- visualizer diagnostics
- future reader enhancements

If a small runtime enhancement is desired, the safest v1 option is:

- include `witnessReactions[].reactionText` in the same post-choice prose path
  that already handles `reactionText`, only when the selected choice has a
  matching reaction and no route immediately replaces the scene.

This is optional and should not block the first implementation.

---

## 9. Implementation Phases

### Phase 1: Types and Prompt Contract

Files:

- `src/types/choice.ts`
- `src/ai-agents/prompts/storyQualityContract.ts`

Tasks:

1. Add `ChoiceAffordanceSource`.
2. Add `WitnessReactionStance`.
3. Add `WitnessReaction`.
4. Add `FailureResidueKind`.
5. Add `FailureResidue`.
6. Add optional fields to `Choice`.
7. Add `STORY_QUALITY_MECHANICAL_REACTIVITY`.
8. Add `mechanicalReactivity` to `buildStoryQualityContractSection`.

Acceptance:

- Existing stories typecheck.
- No runtime behavior changes.
- New fields are exported through the existing type barrel.

### Phase 2: Story Verb Derivation

Files:

- Add `src/ai-agents/utils/storyVerbs.ts`
- Update relevant planning/agent input types.

Tasks:

1. Define `StoryVerb`.
2. Add heuristic verb sets by genre.
3. Add fallback generic verbs for unknown genres.
4. Pass verbs into `ChoiceAuthor`.
5. Pass verbs into `EncounterArchitect` if low-risk in the current call chain.

Acceptance:

- Generation has access to story verbs.
- No agent is required to use an LLM just to derive verbs.
- Unknown genres still receive useful generic verbs.

### Phase 3: ChoiceAuthor Integration

File:

- `src/ai-agents/agents/ChoiceAuthor.ts`

Tasks:

1. Add `storyVerbs?: StoryVerb[]` to `ChoiceAuthorInput`.
2. Include story verbs in prompt when present.
3. Add `storyVerb`, `affordanceSource`, `witnessReactions`, and
   `failureResidue` to required JSON examples.
4. Infer `affordanceSource` from conditions when omitted.
5. Warn, but do not fail, when meaningful choices omit `storyVerb`.
6. Avoid auto-generating witness reactions unless safe.

Acceptance:

- Existing `ChoiceAuthor` tests still pass after updates.
- New tests confirm optional fields can be parsed and preserved.
- Meaningful choices still get `residueHints`.

### Phase 4: Validator

Files:

- Add `src/ai-agents/validators/MechanicalStorytellingValidator.ts`
- Update `src/ai-agents/validators/index.ts`
- Update `src/ai-agents/validators/IntegratedBestPracticesValidator.ts`

Tasks:

1. Implement validation rules from section 6.
2. Add metrics.
3. Register validator in integrated quick/full validation path.
4. Ensure issues use existing validation result shapes.

Acceptance:

- Invalid witness NPC ids are caught.
- Stat-check failures without playable residue produce warnings.
- Missing story verbs produce suggestions, not errors.
- Validator does not fail legacy stories merely because optional fields are
  absent.

### Phase 5: SceneWriter and Callback Prompt Refinement

Files:

- `src/ai-agents/prompts/callbackPromptSection.ts`
- `src/ai-agents/agents/SceneWriter.ts`

Tasks:

1. Expand callback payoff instructions to include micro-reactivity forms.
2. Keep callback hook id rules unchanged.
3. Preserve current cap of max 2 callback variants per scene.

Acceptance:

- Existing callback tests pass.
- Prompt remains compact.
- Callback payoffs can be text variants, NPC asides, environmental echoes, or
  relationship-tone changes.

### Phase 6: Visualizer Diagnostics

Files:

- `src/visualizer/choiceSystemAnalyzer.ts`
- `src/visualizer/residueGraphExpander.ts`

Tasks:

1. Add story verb to choice summaries.
2. Add affordance source to choice summaries.
3. Add witness reaction count or labels.
4. Add failure residue facet.

Acceptance:

- Existing visualizer tests pass.
- New metadata improves author diagnostics without changing player runtime.

---

## 10. Test Plan

Run focused tests after each implementation phase.

### Type and Validator Tests

```bash
npm test -- ChoiceImpactValidator
npm test -- MechanicalStorytellingValidator
npm run typecheck
```

Add tests for:

- optional new fields on `Choice`
- valid witness reaction
- invalid witness NPC id
- off-scene witness warning
- stat check with no playable failure signal
- stat check with `failureResidue`
- stat check with durable consequence but no `failureResidue`
- conditioned choice with inferred affordance source
- missing story verb as suggestion

### ChoiceAuthor Tests

```bash
npm test -- ChoiceAuthor
```

Add tests for:

- `storyVerb` preserved in generated choice
- `affordanceSource` inferred from condition
- `witnessReactions` preserved when valid
- `failureResidue` preserved
- missing `residueHints` still receives current fallback

### Callback Tests

```bash
npm test -- Callback
```

Add or update tests only if callback prompt builders have snapshot-like string
checks. Keep prompt assertions resilient; avoid brittle full-string snapshots
unless that is the existing pattern.

### Full Validation

```bash
npm run typecheck
npm test
```

Use `npm run validate` only when the implementation touches broad pipeline
integration or validator registration.

---

## 11. Acceptance Criteria

The upgrade is complete when:

- New optional choice metadata typechecks and is exported.
- `ChoiceAuthor` can author story verbs, affordance sources, witness reactions,
  and failure residue.
- Generated meaningful choices still include `residueHints`.
- Stat-check failures are validated for playable consequences.
- Witness reaction NPC references are validated.
- Callback prompts support micro-reactivity payoffs.
- Existing generated stories load without migration.
- Branch cap behavior is unchanged.
- No player-facing UI exposes raw mechanics.

---

## 12. Non-Goals

This plan does not include:

- Raising `maxBranchingChoicesPerEpisode`.
- Adding visible stats, dice, odds, or thresholds.
- Building a full companion approval UI.
- Building a party system.
- Adding permanent quest-web branching.
- Replacing the existing callback ledger.
- Replacing `residueHints`.
- Rewriting encounter runtime.
- Adding a new reader UI surface in v1.

---

## 13. Implementation Notes

### Backward Compatibility

All new fields must be optional. Existing generated JSON should continue to
deserialize and play without changes.

### Prompt Budget

Keep new prompt sections compact. Do not paste this whole plan into agent
prompts. Use the small contract fragment and concise JSON schema additions.

### Failure Residue Should Not Become Punishment Spam

Not every failed check needs a huge callback. The target is playable texture,
not constant punishment. Minor failures can create immediate prose residue;
major failures should create durable residue.

### Witness Reactions Should Be Sparse

Witness reactions are most powerful when they feel selected. Do not require
them on every choice. Prefer them when:

- a core NPC is present
- the choice tests shared values
- the player violates or honors a promise
- the choice changes trust, fear, affection, or respect
- the choice reveals a stable identity pattern

### Story Verbs Are Metadata, Not UI Labels

Do not display `storyVerb` directly to the player. It is there to guide
generation, validation, and diagnostics.

---

## 14. Example End State

Example generated choice:

```json
{
  "id": "choice-pressure-the-witness",
  "text": "Press her before she can recover.",
  "choiceType": "strategic",
  "choiceIntent": "blind",
  "impactFactors": ["information", "relationship", "identity"],
  "consequenceTier": "sceneTint",
  "storyVerb": "pressure",
  "affordanceSource": "skill",
  "stakes": {
    "want": "learn who paid her",
    "cost": "make fear the price of truth",
    "identity": "someone who treats panic as leverage"
  },
  "statCheck": {
    "skillWeights": {
      "intimidation": 0.5,
      "perception": 0.3,
      "deception": 0.2
    },
    "difficulty": 58
  },
  "consequenceDomain": "information",
  "consequences": [
    { "type": "changeScore", "score": "witness_pressure", "change": 1 },
    { "type": "relationship", "npcId": "mara", "dimension": "fear", "change": 8 }
  ],
  "reminderPlan": {
    "immediate": "The witness answers, but the room hears how you got there.",
    "shortTerm": "Mara keeps more distance in the next exchange.",
    "later": "Someone repeats your method back to you when asking for trust."
  },
  "feedbackCue": {
    "echoSummary": "You turned fear into leverage.",
    "progressSummary": "This changes who feels safe around you.",
    "checkClass": "dramatic"
  },
  "outcomeTexts": {
    "success": "Her story breaks cleanly. She names the courier and then stares at the floor as if the name itself has teeth.",
    "partial": "She gives you the courier, but not quietly. By the time she stops shaking, everyone nearby knows you forced it out of her.",
    "failure": "She shuts down completely. Worse, the silence gives the courier's ally enough time to slip out through the rear hall."
  },
  "failureResidue": {
    "kind": "lost_leverage",
    "description": "The failed pressure gives the courier's ally time to escape and makes the witness harder to reach later."
  },
  "witnessReactions": [
    {
      "npcId": "mara",
      "stance": "questions",
      "reactionText": "Mara does not interrupt, but her hand leaves your sleeve.",
      "residueHint": "Mara later questions whether the player can tell the difference between urgency and cruelty."
    }
  ],
  "residueHints": [
    {
      "kind": "relationship_behavior",
      "description": "Mara becomes colder after watching the player use fear as leverage.",
      "targetNpcId": "mara"
    },
    {
      "kind": "later_text_variant",
      "description": "A later witness reacts differently if the player is known for pressure tactics."
    }
  ],
  "visualResidueHint": "Mara stands farther from the player in the next shared image.",
  "tintFlag": "tint:ruthless"
}
```

This example does not create a permanent branch, but it changes information,
relationship behavior, identity texture, later callback material, failure
consequences, and visual staging. That is the target shape of this upgrade.
