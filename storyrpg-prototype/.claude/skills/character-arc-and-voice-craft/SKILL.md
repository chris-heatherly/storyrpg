---
name: character-arc-and-voice-craft
description: >-
  Use this skill when authoring or validating character craft — protagonist identity arcs, the six
  identity axes and per-episode deltas, voice profiles, NPC relationship depth, and the Want/Fear/Flaw
  trinity. Applies to CharacterDesigner, CharacterArcTracker, and the CharacterProfile / VoiceProfile /
  CharacterRelationship / IdentityAxisTarget / RelationshipTrajectoryTarget types.
---

# Character Arc and Voice Craft

The craft contract the generation pipeline authors against. These are the rules agent prompts enforce
and `pipeline-validation` validators protect — change the rule here and the prompt/validator together,
never one in isolation. The two authoring agents are `CharacterDesigner` (the static character bible:
identity, voice, relationships, secrets) and `CharacterArcTracker` (per-episode arc *targets*: identity
deltas, relationship trajectories, milestones). Their outputs are audited by `NPCDepthValidator` and
`ArcDeltaValidator`.

## The six identity axes

The protagonist's identity is six signed integers on `IdentityProfile` (`src/types/player.ts`), each
ranging `-100` to `+100`. These are the **only** valid axes; `CharacterArcTracker` targets must key
against them exactly.

| Axis | `-100` pole | `+100` pole | Grouping |
| --- | --- | --- | --- |
| `mercy_justice` | mercy | justice | Moral compass |
| `idealism_pragmatism` | idealism | pragmatism | Moral compass |
| `cautious_bold` | cautious | bold | Social style |
| `loner_leader` | loner | leader | Social style |
| `heart_head` | heart / emotion | head / logic | Approach |
| `honest_deceptive` | honest | deceptive | Approach |

All six start at `0` (`DEFAULT_IDENTITY_PROFILE`). Identity is *expressed through choices*, never shown
as a numeric label to the player (fiction-first).

## Per-episode identity deltas

`CharacterArcTracker` emits `IdentityAxisTarget[]` — one signed `delta` per axis it wants the episode to
move, with a `rationale`. The rules its prompt enforces and `ArcDeltaValidator` audits:

- **Bounded deltas.** Each per-episode `delta` is a signed integer in the range **`[-40, +40]`**. Do not
  attempt the full arc in one episode.
- **Few targets, hit hard.** Prefer **2–3 identity targets** per episode. Fewer targets hit well beat
  many targets hit weakly.
- **Axes must be real.** Every `axis` must be one of the six `IdentityProfile` keys above.
- **Deltas serve the spine, not drift.** Deltas should move the protagonist *toward or away from the
  season Goal / Stakes* and the current Story Circle role, not wander randomly. The
  start-vs-end identity state is compared back to these targets by `ArcDeltaValidator`.
- **Architecture is pressure, not exposition.** Targets should make the protagonist act from the **Lie**,
  strain toward the **Truth**, expose the **origin pressure**, or force a **Want-vs-Need** choice (the
  `characterArchitecture` fields on `ProtagonistCharacterArchitecture`). Never surface those labels to
  the player.

## Arc phases

Every `ArcMilestone` carries a `phase` from this exact five-value enum (`CharacterArcTracker.ts`). The
ordered progression and what each phase must do:

| Order | `phase` value | What the phase does |
| --- | --- | --- |
| 1 | `establishment` | Show the starting identity and its limits. |
| 2 | `test` | Challenge that identity — force a choice. |
| 3 | `turning_point` | The character commits to change (or doubles down). |
| 4 | `commitment` | Actions consistent with the new identity. |
| 5 | `resolution` | Final form; relationships restructured. |

Phases align to the episode's Story Circle role: `find` episodes should emit a `turning_point`
milestone; `take`, `return`, and `change` episodes should emit `commitment` or `resolution` milestones.
Milestones must anchor to blueprint scenes (`sceneId` / `beatId`) when possible.

## The four relationship dimensions and NPC tiers

NPCs track up to four relationship dimensions — **trust, affection, respect, fear** (`RELATIONSHIP_DIMENSIONS`
in `src/ai-agents/config/tierRequirements.ts`) — measuring, respectively, how much the NPC *believes*,
*likes*, *admires*, and is *intimidated by* the protagonist. How many an NPC must author depends on its
`tier`, which `CharacterDesigner` assigns by **narrative weight, not as a rating**. `NPCDepthValidator`
enforces the minimums.

| Tier | Required relationship dimensions | Who qualifies |
| --- | --- | --- |
| `core` | **all 4** (trust, affection, respect, fear) | Protagonist, primary antagonist, recurring main cast carrying a full arc + full voiceProfile + want/fear/flaw + a secret. Usually 2–4 per story. |
| `supporting` | **at least 2** (chosen to fit the role) | Named secondary NPCs across multiple scenes, with a distinct voiceProfile. Usually 3–6 per story. |
| `background` | **at least 1** | One-scene / ambient NPCs; voice and personality may be minimal. |

`tier` is structural: an `ally` whose only scene is a brief introduction is `background`, not `core`.
Per-episode relationship movement is authored separately by `CharacterArcTracker` as
`RelationshipTrajectoryTarget[]` (`trustDelta` / `respectDelta` / `bondDelta` + a narrative `trajectory`
like `"warm → cautious"`); each must name a real NPC id from the character bible. The general
consequence/relationship-consequence mechanics those deltas feed are owned by `story-structure-rules` —
reference it rather than restating them here.

## The Want/Fear/Flaw trinity

Every significant character MUST have all three (`CharacterProfile.want` / `.fear` / `.flaw`):

- **WANT** — the active goal they're pursuing (external motivation).
- **FEAR** — what they're running from or avoiding (internal motivation).
- **FLAW** — the weakness that creates conflict (the obstacle).

**The best characters have wants, fears, and flaws that conflict with each other** — internal
contradiction is the point, not a defect.

### Pixar-depth (strong opinions)

`CharacterProfile.pixarDepth` adds an opinionated spine: `coreOpinion` (what they believe strongly),
`personalStakes` (why it matters to them personally), `strongOpinionOn` (a topic they have strong views
on), and `polarOpposite` (their worst nightmare / opposite). Characters with strong opinions generate
conflict on contact.

## Voice profiles

`VoiceProfile` (`CharacterDesigner.ts`) makes each character sound unmistakable — **a reader should
identify the speaker without dialogue tags.** Every field is load-bearing:

| Field | Allowed values / shape |
| --- | --- |
| `vocabulary` | `simple` \| `educated` \| `technical` \| `poetic` \| `street` (register) |
| `sentenceLength` | `terse` \| `average` \| `verbose` |
| `formality` | `casual` \| `neutral` \| `formal` |
| `verbalTics` | string[] — fillers, sentence starters, phrases they return to |
| `favoriteExpressions` | string[] |
| `avoidedWords` | string[] — words they'd *never* use |
| `whenHappy` / `whenAngry` / `whenNervous` / `whenLying` | strings — how speech *changes* per emotion (the emotional tells) |
| `greetingExamples` / `farewellExamples` / `underStressExamples` | string[] sample lines |
| `signatureLines` | string[] catchphrases / memorable quotes (optional) |
| `writingGuidance` | string — dialogue notes for downstream writers |

**Every character must sound different.** Distinguish via vocabulary, rhythm, and verbal tics; speech
patterns reveal background, education, and personality. **Emotional tells are deltas, not states** —
define how speech *shifts* (faster/clipped/rambling/over-detailed), not a static mood. Provide at least
**3 signature lines that only THIS character would say**.

## Micro-lies and protective beliefs — behavior, not exposition

A character's **Lie / protective belief** (`ProtagonistCharacterArchitecture.lie`,
`SupportingCharacterMicroArc.microLie`) is **agent-facing only**. It must **never be shown to the player
as a label**; scenes express it through behavior and choices, and through `protagonistVisibleSignals` for
supporting cast. Secrets follow the same discipline: `CharacterProfile.secrets` (and the legacy
`hiddenSecret`) are surfaced across the story through action and reveal, not stated outright. The
`originPressure` behind a Lie need not be a trauma-wound template — it may be success, social
conditioning, deprivation, betrayal, a vow, humiliation, fear, or survival adaptation. Show, don't tell:
reveal character through action and dialogue; let players discover depths over time.

## See also
- `story-structure-rules` — consequence factors and relationship-consequence mechanics that
  per-episode deltas/trajectories feed into.
- `pipeline-validation` — `NPCDepthValidator` (tier dimension minimums) and `ArcDeltaValidator`
  (start-vs-end identity vs targets) that enforce this contract.
- `pipeline-agent-development` — how `CharacterDesigner` / `CharacterArcTracker` extend `BaseAgent`,
  prompt, and parse JSON output.
- Source: `src/ai-agents/agents/CharacterDesigner.ts` (CharacterProfile, VoiceProfile, tiers,
  Want/Fear/Flaw, Pixar-depth, secrets), `src/ai-agents/agents/CharacterArcTracker.ts` (identity
  targets, arc phases, relationship trajectories), `src/types/player.ts` (`IdentityProfile`),
  `src/ai-agents/config/tierRequirements.ts` (dimensions + tier minimums),
  `src/ai-agents/prompts/storytellingPrinciples.ts` (`NPC_DEPTH_TIERING`),
  `src/types/sourceAnalysis.ts` (Lie / origin pressure / Truth / micro-arc architecture).
