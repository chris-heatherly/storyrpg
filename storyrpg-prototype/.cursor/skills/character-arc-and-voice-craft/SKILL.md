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

Why two agents: the bible is authored **once** and is path-independent (it describes who a character
*is*, regardless of which branch the player walks). The tracker runs **per episode** and converts the
season's planned arc into measurable targets the episode's choices must move toward. Keeping them
separate is what lets `ArcDeltaValidator` compare a concrete plan (targets) against the consequences the
`ChoiceAuthor` actually wrote — a static bible could never be diffed that way.

## The six identity axes

The protagonist's identity is six signed integers on `IdentityProfile` (`src/types/player.ts`), each
ranging `-100` to `+100`. These are the **only** valid axes; `CharacterArcTracker` targets must key
against them exactly. The exact source type:

```typescript
// src/types/player.ts
export interface IdentityProfile {
  // Moral compass
  mercy_justice: number;          // -100 (mercy) to +100 (justice)
  idealism_pragmatism: number;    // -100 (idealism) to +100 (pragmatism)

  // Social style
  cautious_bold: number;          // -100 (cautious) to +100 (bold)
  loner_leader: number;           // -100 (loner) to +100 (leader)

  // Approach
  heart_head: number;             // -100 (heart/emotion) to +100 (head/logic)
  honest_deceptive: number;       // -100 (honest) to +100 (deceptive)
}

export const DEFAULT_IDENTITY_PROFILE: IdentityProfile = {
  mercy_justice: 0,
  idealism_pragmatism: 0,
  cautious_bold: 0,
  loner_leader: 0,
  heart_head: 0,
  honest_deceptive: 0,
};
```

| Axis | `-100` pole | `+100` pole | Grouping |
| --- | --- | --- | --- |
| `mercy_justice` | mercy | justice | Moral compass |
| `idealism_pragmatism` | idealism | pragmatism | Moral compass |
| `cautious_bold` | cautious | bold | Social style |
| `loner_leader` | loner | leader | Social style |
| `heart_head` | heart / emotion | head / logic | Approach |
| `honest_deceptive` | honest | deceptive | Approach |

All six start at `0` (`DEFAULT_IDENTITY_PROFILE`). Values near `0` mean the player hasn't yet *strongly
established* that trait — identity **emerges from accumulated choices**, it is not chosen up front.
Identity is *expressed through choices*, never shown as a numeric label to the player (fiction-first):
the player feels "I keep choosing mercy," not "mercy_justice = -45". `previousIdentityProfile` is also
stored on `PlayerState` so the runtime can detect movement between snapshots.

## Per-episode identity deltas

`CharacterArcTracker` emits `IdentityAxisTarget[]` — one signed `delta` per axis it wants the episode to
move, with a `rationale`. The exact source types it returns:

```typescript
// src/ai-agents/agents/CharacterArcTracker.ts
export interface IdentityAxisTarget {
  axis: keyof IdentityProfile;  // must be one of the six axes above
  delta: number;                // signed delta target for this episode (e.g. +15)
  rationale: string;            // author rationale for why the episode moves this axis
}

export interface CharacterArcTargets {
  episodeId: string;
  identityTargets: IdentityAxisTarget[];
  relationshipTargets: RelationshipTrajectoryTarget[];
  milestones: ArcMilestone[];
  arcPhaseHeadline: string;
}
```

The rules its prompt enforces and `ArcDeltaValidator` audits:

- **Bounded deltas.** Each per-episode `delta` is a signed integer in the range **`[-40, +40]`**. This
  is not advisory — `normalizeTargets()` *clamps* it: `Math.max(-40, Math.min(40, Math.round(delta)))`.
  Do not attempt the full arc in one episode; a season-long swing from `0` to `+90` should be spread
  across several episodes.
- **Few targets, hit hard.** Prefer **2–3 identity targets** (and **1–3 relationship targets**) per
  episode. Fewer targets hit well beat many targets hit weakly — a diffuse plan dilutes every choice's
  consequence budget and fails the validator's hit-rate check.
- **Axes must be real.** Every `axis` must be one of the six `IdentityProfile` keys above.
  `normalizeTargets()` silently **filters out** any target whose `axis` is not in the valid set, so a
  typo'd axis disappears rather than erroring — get the key exactly right.
- **Deltas serve the spine, not drift.** Deltas should move the protagonist *toward or away from the
  season Goal / Stakes* and the current Story Circle role, not wander randomly. The
  start-vs-end identity state is compared back to these targets by `ArcDeltaValidator`.
- **Architecture is pressure, not exposition.** Targets should make the protagonist act from the **Lie**,
  strain toward the **Truth**, expose the **origin pressure**, or force a **Want-vs-Need** choice (the
  `characterArchitecture` fields on `ProtagonistCharacterArchitecture`, passed in agent-facing only).
  Never surface those labels to the player.

### Example identity-delta set for one episode

A "test"-phase episode where the protagonist's mercy is repeatedly punished and honesty starts to cost
them progress:

```json
{
  "episodeId": "episode-2",
  "arcPhaseHeadline": "Test: kindness keeps getting Mara hurt; the protagonist hardens",
  "identityTargets": [
    { "axis": "mercy_justice", "delta": 18, "rationale": "Mercy options backfire visibly this episode; justice begins to feel earned, not cruel." },
    { "axis": "cautious_bold", "delta": 12, "rationale": "The safe play costs an ally; the episode rewards a bolder commitment." },
    { "axis": "honest_deceptive", "delta": -8, "rationale": "Forcing the protagonist to tell the truth even when a lie would smooth the path." }
  ]
}
```

Note: three targets (the recommended 2–3), every delta inside `[-40, +40]`, and each `rationale` ties
the movement to a concrete scene pressure rather than a vague trait label.

### How `ArcDeltaValidator` decides a target was "hit"

`ArcDeltaValidator` (`src/ai-agents/validators/ArcDeltaValidator.ts`) takes the `targets` plus a
`startIdentity` / `endIdentity` pair (simulated from accumulated consequences, or observed from a real
`PlayerState`) and per-NPC `relationshipDeltas`. A planned delta counts as **hit** when:

```typescript
// TOLERANCE_ABS = 5, MIN_FRACTION = 0.5
private deltaHit(planned: number, observed: number): boolean {
  if (planned === 0) return Math.abs(observed) <= TOLERANCE_ABS;          // a "no-move" target
  if (Math.sign(planned) !== Math.sign(observed)) return false;          // wrong direction = miss
  if (Math.abs(observed - planned) <= TOLERANCE_ABS) return true;        // within ±5 of plan
  if (Math.abs(observed) >= Math.abs(planned) * MIN_FRACTION) return true; // ≥50% of plan, same way
  return false;
}
```

Severity matters for the abort/retry loop:

- An identity target that **moved the opposite way** from the plan is an `error` (`wrongDirection`) and
  makes the result invalid (`valid: errors === 0`).
- A target that merely **fell short** (right direction, too small) is a `warning` — it lowers the score
  but does not block.
- Relationship targets are always `warning` on a miss; a relationship target only counts as hit when
  **every specified axis** (`trustDelta` / `respectDelta` / `bondDelta`) it declared was individually
  hit. The score is `round(hit / total * 100)` over all identity + relationship targets.

The practical lesson: the cheapest way to fail this validator hard is to write choices whose
consequences push an axis the *wrong direction* relative to the plan. Falling a little short is
forgivable; reversing the arc is not.

## Arc phases

Every `ArcMilestone` carries a `phase` from this exact five-value enum (`CharacterArcTracker.ts`):

```typescript
export interface ArcMilestone {
  id: string;            // used for flag-style tracking
  sceneId?: string;      // scene where the milestone should land
  beatId?: string;       // beat where the milestone should land
  description: string;   // e.g. "refuses mentor's gift"
  phase: 'establishment' | 'test' | 'turning_point' | 'commitment' | 'resolution';
}
```

The ordered progression and what each phase must do:

| Order | `phase` value | What the phase does |
| --- | --- | --- |
| 1 | `establishment` | Show the starting identity and its limits. |
| 2 | `test` | Challenge that identity — force a choice. |
| 3 | `turning_point` | The character commits to change (or doubles down). |
| 4 | `commitment` | Actions consistent with the new identity. |
| 5 | `resolution` | Final form; relationships restructured. |

Phases align to the episode's Story Circle role (owned by `story-structure-rules`): `find` episodes
should emit a `turning_point` milestone; `take`, `return`, and `change` episodes should emit
`commitment` or `resolution` milestones. This coupling is why the arc never feels arbitrary — the
character's internal pivot is scheduled to land on the Story Circle pivot. Milestones must anchor to
blueprint scenes (`sceneId` / `beatId`) when possible so downstream agents can attach the milestone flag
to a concrete moment; if the LLM omits `phase`, `normalizeTargets()` defaults it to `'test'`.

## The four relationship dimensions and NPC tiers

NPCs track up to four relationship dimensions — **trust, affection, respect, fear**
(`RELATIONSHIP_DIMENSIONS` in `src/ai-agents/config/tierRequirements.ts`) — measuring, respectively, how
much the NPC *believes*, *likes*, *admires*, and is *intimidated by* the protagonist. The runtime
`Relationship` record stores them as signed values (`trust`/`affection`/`respect` are `-100..100`,
`fear` is `0..100`):

```typescript
// src/types/player.ts
export interface Relationship {
  npcId: string;
  trust: number;      // -100 to 100
  affection: number;  // -100 to 100
  respect: number;    // -100 to 100
  fear: number;       // 0 to 100
}

// src/types/story.ts
export type NPCTier = 'core' | 'supporting' | 'background';
export type RelationshipDimension = 'trust' | 'affection' | 'respect' | 'fear';
export interface TieredNPC {
  id: string;
  name: string;
  tier: NPCTier;
  relationshipDimensions: RelationshipDimension[];
}
```

How many dimensions an NPC must author depends on its `tier`, which `CharacterDesigner` assigns by
**narrative weight, not as a rating**. The single source of truth for the minimums is
`tierRequirements.ts`, consumed by both the designer prompt (`describeTierRequirements()`) and the
validator so they cannot drift:

```typescript
// src/ai-agents/config/tierRequirements.ts
export const DEFAULT_TIER_REQUIREMENTS: Record<NPCTier, number> = {
  core: 4,
  supporting: 2,
  background: 1,
};
export const RELATIONSHIP_DIMENSIONS = ['trust', 'affection', 'respect', 'fear'] as const;
```

| Tier | Required relationship dimensions | Who qualifies |
| --- | --- | --- |
| `core` | **all 4** (trust, affection, respect, fear) | Protagonist, primary antagonist, recurring main cast carrying a full arc + full voiceProfile + want/fear/flaw + a secret. Usually 2–4 per story. |
| `supporting` | **at least 2** (chosen to fit the role, e.g. a mentor tracks Trust + Respect) | Named secondary NPCs across multiple scenes, with a distinct voiceProfile. Usually 3–6 per story. |
| `background` | **at least 1** | One-scene / ambient NPCs; voice and personality may be minimal. |

`tier` is structural: an `ally` whose only scene is a brief introduction is `background`, not `core`.

### How `NPCDepthValidator` enforces it

`NPCDepthValidator` (`src/ai-agents/validators/NPCDepthValidator.ts`) prefers the authored `tier`, but
when a legacy bible omits it, `inferTier()` falls back to importance/role:

- `importance === 'major'` **or** `role === 'antagonist'` **or** `role === 'ally'` → `core`
- `importance === 'supporting'` **or** `role === 'neutral'` → `supporting`
- otherwise → `background`

For `core` NPCs it requires *all four named* dimensions (not just a count of four); for the other tiers
it only checks the count. When validating from raw character-bible shape (`validateCast`), the
protagonist (`role === 'protagonist'`) is filtered out — they are not an NPC — and a dimension counts as
"present" only if its `initialStats.<dim>` is defined. The default severity is **`error`**
(`level: 'error'`), but it is configurable (`minMajorDimensions` can also override the core count);
because `CharacterDesigner` does not always emit every dimension, missing-dimension issues use the
configured level rather than force-erroring. `getSummary()` reports valid/total per tier.

### Per-episode relationship trajectories

Per-episode relationship *movement* is authored separately by `CharacterArcTracker` as
`RelationshipTrajectoryTarget[]`:

```typescript
// src/ai-agents/agents/CharacterArcTracker.ts
export interface RelationshipTrajectoryTarget {
  npcId: string;          // must name a real NPC id from the character bible
  trustDelta?: number;
  respectDelta?: number;
  bondDelta?: number;
  trajectory: string;     // narrative target, e.g. "warm → cautious"
  rationale: string;
}
```

Example trajectory for an episode where an ally's faith is shaken but the underlying bond hardens:

```json
{
  "npcId": "mara",
  "trustDelta": -10,
  "bondDelta": 8,
  "trajectory": "warm and unguarded → guarded but loyal",
  "rationale": "Mara catches the protagonist in a half-truth; trust cracks, but standing by her through the fallout deepens the bond."
}
```

Each target must name a real NPC id from the character bible (the validator keys observed deltas by
`npcId`). The general consequence/relationship-consequence *mechanics* those deltas feed (how a choice
emits a `relationship` consequence) are owned by `story-structure-rules` — reference it rather than
restating them here.

## The Want/Fear/Flaw trinity

Every significant character MUST have all three (`CharacterProfile.want` / `.fear` / `.flaw`):

- **WANT** — the active goal they're pursuing (external motivation).
- **FEAR** — what they're running from or avoiding (internal motivation).
- **FLAW** — the weakness that creates conflict (the obstacle).

**The best characters have wants, fears, and flaws that conflict with each other** — internal
contradiction is the point, not a defect. A guard who *wants* promotion, *fears* being seen as soft, and
is *flawed* by a secret tenderness will generate drama every time those three pull in different
directions; a character whose three align produces no friction.

These live on the static bible alongside identity, voice, and relationships:

```typescript
// src/ai-agents/agents/CharacterDesigner.ts (abridged)
export interface CharacterProfile {
  id: string;
  name: string;
  pronouns: PronounSet;                 // 'he/him' | 'she/her' | 'they/them'
  role: string;
  importance: string;
  tier?: 'core' | 'supporting' | 'background'; // narrative weight (see tiers above)
  secrets?: string[];                   // surfaced across the story, not stated outright

  overview: string;                     // 2-3 sentence summary
  fullBackground: string;

  // The Want/Fear/Flaw trinity
  want: string;                         // what they're actively pursuing
  fear: string;                         // what they're running from
  flaw: string;                         // what holds them back

  traits: string[];                     // 3-5 defining traits
  values: string[];
  quirks: string[];

  physicalDescription: string;
  distinctiveFeatures: string[];
  typicalAttire: string;
  fashionStyle?: CharacterFashionStyle;

  voiceProfile: VoiceProfile;
  relationships: CharacterRelationship[];

  arcPotential: {
    currentState: string;
    possibleGrowth: string;
    possibleFall: string;
    triggerEvents: string[];
  };

  initialStats?: { trust: number; affection: number; respect: number; fear: number };
  skills?: Array<{ name: string; level: number; description?: string }>;
  hiddenSecret?: string;                // legacy single-secret field
  description?: string;

  pixarDepth?: {
    coreOpinion: string;        // what they believe strongly about
    personalStakes: string;     // why it matters to them personally
    strongOpinionOn: string;    // a topic they have strong views on
    polarOpposite: string;      // their worst nightmare / opposite
  };
}
```

### Pixar-depth (strong opinions)

`CharacterProfile.pixarDepth` adds an opinionated spine: `coreOpinion` (what they believe strongly),
`personalStakes` (why it matters to them personally), `strongOpinionOn` (a topic they have strong views
on), and `polarOpposite` (their worst nightmare / opposite). Characters with strong opinions generate
conflict on contact — the moment a strongly-opinioned character meets their `polarOpposite`, a scene has
tension before anyone does anything.

### The static relationship web (`CharacterRelationship`)

Distinct from the runtime `Relationship` scores and the tracker's per-episode trajectories,
`CharacterRelationship` is the *bible-level* description of how two characters stand:

```typescript
// src/ai-agents/agents/CharacterDesigner.ts
export interface CharacterRelationship {
  targetId: string;
  targetName: string;
  relationshipType: string;     // 'friend' | 'enemy' | 'family' | 'romantic' | 'professional' | 'complicated'
  currentDynamic: string;
  history: string;
  unresolvedIssues: string[];   // the tension that drives future scenes
  potentialConflicts: string[];
  couldBecome: string[];        // evolution potential
}
```

The `unresolvedIssues` / `potentialConflicts` / `couldBecome` fields are what give the tracker something
to *move*: a relationship trajectory is only meaningful if the bible established somewhere for it to go.

## Voice profiles

`VoiceProfile` (`CharacterDesigner.ts`) makes each character sound unmistakable — **a reader should
identify the speaker without dialogue tags.** Every field is load-bearing:

```typescript
// src/ai-agents/agents/CharacterDesigner.ts
export interface VoiceProfile {
  // Speech patterns
  vocabulary: 'simple' | 'educated' | 'technical' | 'poetic' | 'street';
  sentenceLength: 'terse' | 'average' | 'verbose';
  formality: 'casual' | 'neutral' | 'formal';

  // Distinctive elements
  verbalTics: string[];          // "You know what I mean?", "Listen...", phrases they return to
  favoriteExpressions: string[];
  avoidedWords: string[];        // words they'd never use

  // Emotional tells (how speech CHANGES, not a static mood)
  whenHappy: string;
  whenAngry: string;
  whenNervous: string;
  whenLying: string;

  // Sample lines
  greetingExamples: string[];
  farewellExamples: string[];
  underStressExamples: string[];

  // Optional catchphrases / memorable quotes
  signatureLines?: string[];

  // Dialogue notes for downstream writers
  writingGuidance: string;
}
```

The five **vocabulary** registers each carry a concrete meaning (from the designer prompt):

| `vocabulary` | What it sounds like |
| --- | --- |
| `simple` | Common words, concrete thinking, direct statements. |
| `educated` | Varied vocabulary, abstract concepts, complex sentences. |
| `technical` | Jargon-heavy, precise, assumes shared knowledge. |
| `poetic` | Metaphorical, rhythmic, emotionally evocative. |
| `street` | Slang, contractions, local color. |

**Every character must sound different.** Distinguish via vocabulary, rhythm, and verbal tics; speech
patterns reveal background, education, and personality. **Emotional tells are deltas, not states** —
define how speech *shifts* (faster/clipped/rambling/over-detailed), not a static mood. Provide at least
**3 signature lines that only THIS character would say**. The `CharacterBible.voiceDistinctions` field
exists specifically to record *how to keep characters from sounding alike*; treat it as the cross-cast
contract that no two voices collapse into the same register.

### Example filled-in VoiceProfile

A weary, dryly-funny dock foreman who hides worry behind sarcasm:

```json
{
  "vocabulary": "street",
  "sentenceLength": "terse",
  "formality": "casual",
  "verbalTics": ["Right, then.", "Look—", trailing off with "...anyway"],
  "favoriteExpressions": ["not my circus", "tide doesn't wait"],
  "avoidedWords": ["lovely", "delighted", "honestly"],
  "whenHappy": "drops the sarcasm for one unguarded sentence, then covers it with a joke",
  "whenAngry": "goes very quiet and clipped; one-word answers, no swearing",
  "whenNervous": "over-explains the logistics of whatever's in front of him to avoid the real subject",
  "whenLying": "adds detail nobody asked for and looks at the water instead of you",
  "greetingExamples": ["You're late. Tide isn't.", "Right, then. What've you broken now?"],
  "farewellExamples": ["Go on. Mind the third plank.", "...anyway. Off you go."],
  "underStressExamples": ["Look—we move the crates or we don't eat. That's the whole of it."],
  "signatureLines": ["Tide doesn't wait, and neither do I.", "Not my circus. Still my dock, though."],
  "writingGuidance": "Never let him say what he feels outright; affection arrives as a chore he does for you. Keep sentences short; cut every adjective you can."
}
```

Note how the emotional tells describe *changes* ("drops the sarcasm", "goes very quiet"), the
`avoidedWords` are as characterizing as the `favoriteExpressions`, and the signature lines could only
belong to this one person.

## Micro-lies and protective beliefs — behavior, not exposition

A character's **Lie / protective belief** is **agent-facing only**. It must **never be shown to the
player as a label**; scenes express it through behavior and choices, and through
`protagonistVisibleSignals` for supporting cast. The architecture types the tracker receives:

```typescript
// src/types/sourceAnalysis.ts
export type CharacterArcMode = 'positive' | 'tragic' | 'ambiguous';

export interface ProtagonistCharacterArchitecture {
  lie: string;              // agent-facing false/protective belief — never a player-facing label
  originPressure: string;   // the formative pressure that made the Lie useful
  truth: string;            // what the protagonist must recognize, or refuse (tragic arc)
  want: string;             // conscious goal
  need: string;             // dramatic necessity underneath the conscious goal
  arcMode: CharacterArcMode;
  climaxChoice: {
    choiceQuestion: string;
    integrateTruthOption: string;   // the option that embraces the Truth
    recommitLieOption: string;      // the option that doubles down on the Lie
    activeChoiceMechanism: string;
  };
}

export interface SupportingCharacterMicroArc {
  characterId: string;
  characterName: string;
  microLie: string;
  originPressure?: string;
  truthOrCounterPressure: string;
  screenTimeTier: 'major' | 'supporting' | 'minor';
  pressureRole: 'mirror' | 'foil' | 'temptation' | 'warning' | 'ally' | 'antagonist';
  protagonistVisibleSignals: string[];   // the only part players ever perceive
  plannedResolution?: string;
}

export interface CharacterArchitecture {
  protagonist: ProtagonistCharacterArchitecture;
  supportingCharacters: SupportingCharacterMicroArc[];
}
```

`climaxChoice` is the mechanical heart of the arc: the Climax episode is supposed to present an active
choice between `integrateTruthOption` (embrace the Truth) and `recommitLieOption` (double down on the
Lie). A `positive` arc resolves toward the Truth, a `tragic` arc toward the Lie, and `ambiguous` leaves
it genuinely open — the `arcMode` tells the writer which way the weight should fall without ever naming
it on the page. Each `SupportingCharacterMicroArc` exists to *pressure* the protagonist's arc; its
`pressureRole` (mirror / foil / temptation / warning / ally / antagonist) says how, and
`protagonistVisibleSignals` is the **only** layer the player perceives — the micro-lie itself stays
hidden.

Secrets follow the same discipline: `CharacterProfile.secrets` (and the legacy `hiddenSecret`) are
surfaced across the story through action and reveal, not stated outright. The `originPressure` behind a
Lie need not be a trauma-wound template — it may be success, social conditioning, deprivation, betrayal,
a vow, humiliation, fear, or survival adaptation. Show, don't tell: reveal character through action and
dialogue; let players discover depths over time.

## See also
- `story-structure-rules` — consequence factors and relationship-consequence mechanics that
  per-episode deltas/trajectories feed into.
- `pipeline-validation` — `NPCDepthValidator` (tier dimension minimums) and `ArcDeltaValidator`
  (start-vs-end identity vs targets) that enforce this contract.
- `pipeline-agent-development` — how `CharacterDesigner` / `CharacterArcTracker` extend `BaseAgent`,
  prompt, and parse JSON output.
- Source: `src/ai-agents/agents/CharacterDesigner.ts` (CharacterProfile, VoiceProfile, tiers,
  Want/Fear/Flaw, Pixar-depth, secrets), `src/ai-agents/agents/CharacterArcTracker.ts` (identity
  targets, arc phases, relationship trajectories), `src/types/player.ts` (`IdentityProfile`,
  `Relationship`), `src/types/story.ts` (`NPCTier`, `RelationshipDimension`, `TieredNPC`),
  `src/ai-agents/config/tierRequirements.ts` (dimensions + tier minimums),
  `src/ai-agents/prompts/storytellingPrinciples.ts` (`NPC_DEPTH_TIERING`),
  `src/ai-agents/validators/ArcDeltaValidator.ts` (delta tolerances + severities),
  `src/ai-agents/validators/NPCDepthValidator.ts` (tier inference + enforcement),
  `src/types/sourceAnalysis.ts` (Lie / origin pressure / Truth / Want-vs-Need / micro-arc architecture).
