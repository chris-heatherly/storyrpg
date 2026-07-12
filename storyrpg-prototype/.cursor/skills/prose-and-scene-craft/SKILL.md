---
name: prose-and-scene-craft
description: Use this skill for StoryRPG's sentence- and scene-level craft rules — fiction-first prose discipline (no exposed stats/dice/percentages/DCs), narrative-intensity tiering (dominant/supporting/rest beats), show-don't-tell + subtext, sensory specificity, the scene-turn contract, the removability test, and the SceneCritic rewrite pass. Reach for it when working on SceneWriter, SceneCritic, StyleArchitect, or the prose side of ChoiceAuthor.
---

# Prose and Scene Craft

The craft contract the generation pipeline authors against. These are the rules agent prompts
enforce and `pipeline-validation` validators protect — change the rule here and the prompt/validator
together, never one in isolation. (This is the *sentence- and scene-level how-to-write*;
`story-structure-rules` is the *what-to-author* at season/scene-graph scale.)

The trigger agents: **SceneWriter** (`agents/SceneWriter.ts` — navigate by prompt
section, don't read whole) drafts beats; **SceneCritic** (`agents/SceneCritic.ts`) does the optional
surgical rewrite; **StyleArchitect** (`agents/StyleArchitect.ts`) sets the visual-style contract; and
**ChoiceAuthor** writes the choice prose that must honor the same fiction-first rules.

## The beat is the unit of prose

Everything here operates on `GeneratedBeat` — the smallest authored prose object. The prose fields
(`text`, `textVariants`), the pacing/length fields (`intensityTier`, `isClimaxBeat`,
`isKeyStoryBeat`), the show-don't-tell metadata (`dramaticIntent`), the storyboard sequencing
(`sequenceIntent`), and the setup/payoff markers all live on the same object, so a craft change usually
touches more than one field at once (`SceneWriter.ts:279-319`):

```typescript
export interface GeneratedBeat {
  id: string;
  text: string;                          // the player-facing prose — the thing this skill governs
  content?: string;                      // fallback field some LLMs emit; normalized into `text`
  textVariants?: TextVariant[];          // conditional prose; same fiction-first rules apply
  speaker?: string;                      // PRESERVED by SceneCritic
  speakerMood?: string;                  // PRESERVED by SceneCritic
  // Pacing / length tier — see Narrative-intensity tiering
  intensityTier?: 'dominant' | 'supporting' | 'rest';  // REQUIRED on every beat
  isClimaxBeat?: boolean;                // raises the word cap; max 1-2 per scene
  isKeyStoryBeat?: boolean;              // raises the word cap; capped count per scene
  // Show-don't-tell + storyboard metadata — see scene-turn contract
  dramaticIntent?: Beat['dramaticIntent'];   // objective/obstacle/status/subtext/visibleTurn
  sequenceIntent?: Beat['sequenceIntent'];   // setup->pressure->turn->consequence storyboard role
  // Setup/payoff + plot-point markers — PRESERVED by SceneCritic
  plantsThreadId?: string;
  paysOffThreadId?: string;
  plotPointType?: 'setup' | 'payoff' | 'twist' | 'revelation';
  twistKind?: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
  // ...visual contract fields (visualMoment, primaryAction, emotionalRead, mustShowDetail, etc.)
}
```

Beats compose into a `SceneContent` (`SceneWriter.ts:321-359`); the scene-level craft anchors are
`moodProgression`, `keyMoments`, `sceneTakeaways`, and the scene-level `sequenceIntent`. The
`SceneCraftValidator` cross-checks that the prose actually delivers those anchors (see severities
below), so they are not decoration — they are the contract the beats are graded against.

## Fiction-first prose discipline

The non-negotiable. From `STORY_QUALITY_FICTION_FIRST` (`prompts/storyQualityContract.ts:8-13`):

- **Rules follow fiction.** Player-facing prose **never exposes stats, dice, percentages,
  thresholds, or system math.**
- Mechanics may change flags, scores, relationships, routes, callbacks, and variants — but the player
  experiences them only as **story pressure.**
- **Growth, failure, locks, and advantage must be legible through action, dialogue, risk, leverage, or
  consequence** — never through a number.

SceneWriter's "Player-Facing Prose" section adds: no template variables or unresolved placeholders in
story text, `textVariants`, visual contracts, choice text, or callbacks. Use the protagonist's actual
name, concrete pronouns, or second-person (`you`/`your`); NPCs use exact names and concrete pronouns.

Diegetic legibility (from `FICTION_FIRST_GAME_FEEL`, `storytellingPrinciples.ts:350-352`): prefer
**risk/leverage framing** the player can feel — "steady", "desperate", "they trust you", "you're out
of your depth" — over any surfaced score. Then give major outcomes both an **instant sensory hit and a
lingering residue** (Lasting Residue, `:354-356`) so the change stays felt, not stated.

**Why the rule exists:** the runtime carries flags, scores, relationship dimensions, and stat checks
under the hood, but the moment a number leaks into prose ("+2 Trust", "DC 14 check", "67% success")
the player drops out of the fiction and starts optimizing a spreadsheet. The whole product wager is
that the math stays invisible and the story stays felt.

**On-the-nose vs. fiction-first:**

> ❌ "Your stealth check failed, so the guard spots you and your Suspicion rises to 3."
> ✅ "Gravel shifts under your heel. The guard's lantern swings toward you before you can flatten
>    against the wall — and now he knows someone is here."

The same flag (`suspicion += 1`, `flag:seen`) changes hands in both; only the second is shippable.

> The player-facing side of this rule is also documented from the runtime in `story-playback` and in
> `docs/STORY_QUALITY_CONTRACT.md`. Reference those — don't duplicate the runtime enforcement here.

## Narrative-intensity tiering

From `NARRATIVE_INTENSITY_RULES` (`prompts/storytellingPrinciples.ts:360-381`). A scene is a musical
phrase: it needs dominant notes, supporting notes, and rests. **Every scene must vary its beat
intensity — a scene where every beat hits at the same level is a failure.** Every beat carries an
`intensityTier` field, **REQUIRED** per the Beat Visual Contract (`SceneWriter.ts:613`):

```typescript
intensityTier?: 'dominant' | 'supporting' | 'rest';  // assign on EVERY beat
```

| Tier         | Per scene   | What it does                                                              |
| ------------ | ----------- | ------------------------------------------------------------------------ |
| `dominant`   | 1–2         | Peak drama: strongest selective sensory detail, highest emotional pressure, most vivid action. Climaxes, confrontations, betrayals, triumphs — written so the reader feels it in the body. |
| `supporting` | majority    | Advance the plot: active prose, forward momentum, clear actions/reactions, standard length. The engine of the story. |
| `rest`       | 1–2         | Breathing room: shorter prose, environmental/atmospheric, quieter. A character processing, a mood-setting detail, stillness before the next escalation — making the dominant beats land harder. |

**Beat-sequence shape (pacing arc):** open with a **supporting or rest** beat to orient the reader →
build through **supporting** beats → hit one **dominant** peak → follow with a **rest** beat to let it
land → build again if there's a second peak → **end on a supporting or dominant** beat leading into the
choice/transition.

**Tagged example (a 5-beat confrontation scene):**

```
Beat 1  intensityTier: "rest"        "The kettle ticks as it cools. Mara won't look at you."
Beat 2  intensityTier: "supporting"  "You slide the ledger across the table. 'Page nine,' you say."
Beat 3  intensityTier: "supporting"  "She turns the page. Her thumb stops moving."
Beat 4  intensityTier: "dominant"    "'Where did you get this.' Not a question. The chair scrapes
          (isClimaxBeat: true)        back, and for the first time she's between you and the door."
Beat 5  intensityTier: "rest"        "Outside, a car passes. Neither of you breathes."
```

The dominant beat lands harder *because* it's bracketed by rests; flatten beats 1 and 5 to the same
pitch and the scene reads as a monotone.

Tier-bound length caps live in the Beat Structure section (`SceneWriter.ts:500-523`). Standard beats
cap at the configured `maxSentences`/`maxWords` (target 2–3 sentences); `isClimaxBeat: true` raises the
cap to `TEXT_LIMITS.maxClimaxBeatWordCount` (the single most intense moment, **max 1–2 per scene**);
`isKeyStoryBeat: true` raises it to `TEXT_LIMITS.maxKeyStoryBeatWordCount` (crucial turning points, max
`TEXT_LIMITS.maxKeyStoryBeatsPerScene` per scene). At enforcement time the word cap is selected as
`isClimaxBeat ? maxClimaxBeatWordCount : isKeyStoryBeat ? maxKeyStoryBeatWordCount : maxWords`
(`SceneWriter.ts:1661-1664`). Short beats are deliberate — mobile screens, tap-to-advance
interactivity. **Do not write paragraphs.** From the prompt's own example (`SceneWriter.ts:525-531`):

> ❌ TOO LONG: "The tavern was dim and smoky, filled with the murmur of conversations and the clink of
>   glasses. You pushed through the crowd, scanning faces until you spotted your contact..."
> ✅ CORRECT (split across beats):
>   Beat 1: "The tavern was dim and smoky. You pushed through the crowd, scanning for your contact."
>   Beat 2: "There—a shadowy corner booth. A tall woman with sharp features watched you approach."
>   Beat 3: "Her cold eyes assessed you instantly. She gestured for you to sit, expression unreadable."

## Show-don't-tell + subtext

SceneWriter's "Prose And Dialogue Craft" (`SceneWriter.ts:455-479`) and `CRAFT_PRESSURE_GUIDANCE`
(`storytellingPrinciples.ts:404-409`):

- **Do not directly describe characters' thoughts and feelings.** Externalize inner life through brief
  dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling,
  hesitation, distance/closeness, facial expression, choice behavior, callback objects, or what the
  character does next.
- **Characters rarely say what they mean in charged moments.** Dialogue stays spare, pointed, and
  subtextual; conversations need friction, competing agendas, avoidance, teasing, or vulnerability —
  not always overt argument. Avoid speeches unless source style, genre, ritual, confession, comedy, or
  climax truly calls for one.
- Under jeopardy, dialogue gets more pointed, urgent, interrupted, selective, stripped down: as fear /
  danger / exposure / time pressure rises, **reduce explanation and sharpen what's said.**
- Reveal motivation, fear, desire, guilt, suspicion, grief through action, choice, speech, silence,
  bodily response, facial expression, object handling, avoidance, proximity, and risk.
- Never let dialogue state the theme directly — express `themePressure` through action, cost, choice,
  subtext, relationship pressure, information, or identity movement (`SceneWriter.ts:431`).

**Why:** declarative emotion ("she was terrified") asks the reader to take dictation; behavior ("her
hand found the door handle and stayed there") makes them *do the inference*, which is what makes a
scene feel inhabited rather than reported. The `SceneCraftValidator` even keeps a
`DIRECT_THOUGHT_FEELING_TERMS` regex (`you feel`, `was afraid`, `realized`, `thought to herself`,
`knew that`…) to catch the tell.

**On-the-nose → subtext rewrites:**

> ❌ "I'm really angry that you lied to me," she said angrily.
> ✅ She refilled his glass to the brim and set the bottle down without a word.

> ❌ "I'm scared we won't make it out," he admitted, feeling afraid.
> ✅ He checked the exits twice. "Plenty of time," he said, already moving.

> ❌ The theme of this story is that trust must be earned. "Trust has to be earned," Mara explained.
> ✅ Mara took the key but didn't pocket it. She left it on the table, in reach of them both.

## Sensory specificity

From "Prose And Dialogue Craft" (`SceneWriter.ts:467-475`):

- **Sensory detail is selective and purposeful** — it establishes place, mood, danger, intimacy,
  texture, or consequence. **Do not force all five senses into every beat.**
- Description must be **dynamic**: details carry pressure, mood, threat, desire, consequence, movement,
  or contrast — not static scenery.
- "Vivid" means **specific story intent, sensory clarity, emotional legibility, image-safe detail** —
  not ornate prose or conflicting art direction. Avoid abstract-only phrases ("tension rises",
  "emotion deepens"); describe what is physically visible, always using character names.
- Vary sentence rhythm with pressure: shorter/sharper under danger or fear; slightly longer for
  atmosphere, aftermath, tenderness, or dread (within mobile beat caps).

The validator backs this with a `GENERIC_DESCRIPTION_TERMS` blocklist (`beautiful`, `nice`, `scary`,
`strange`, `very`, `really`, `somehow`, `kind of`…) and rewards `SENSORY_PLACE_TEXTURE_TERMS` and
`CONCRETE_DETAIL_TERMS` instead.

> ❌ The room was beautiful and the mood was very tense.
> ✅ Cold marble, a chandelier missing half its bulbs. Their footsteps echoed; nobody filled the
>    silence.

## The scene-turn contract

From `CORE_DRAMATIC_STRUCTURE_RULES` (`storytellingPrinciples.ts:463-475`), reinforced in SceneWriter's
"Scene Authorship" rules. **Every scene must satisfy** (and `SceneTurnContractValidator` raises each
missing element as an **`error`**, `SceneTurnContractValidator.ts:257-303`):

1. **Entry intent** — a character wants something on entry.
2. **Active obstacle** — something resists that intent.
3. **Forced decision** — a visible player choice, character commitment, refusal, revelation,
   sacrifice, tradeoff, or irreversible reaction.
4. **Exit shift** — changed footing on the way out.

Rest and aftermath scenes still need intent, resistance, and changed footing.

**Power-dynamic shift:** in multi-character scenes, the power dynamic must shift **at least once** —
leverage, trust, vulnerability, intimacy, distance, status, information, threat, debt, or
public/private advantage changes hands (`storytellingPrinciples.ts:468-470`; `SceneWriter.ts:434`).
The validator escalates this to an `error` for major/high-pressure planned scenes, `warning` otherwise
(`SceneTurnContractValidator.ts:289-295`).

**Removability test:** if removing a scene changes no information, relationship, identity,
resource/access, danger, promise, payoff, choice consequence, theme pressure, stakes, route state, or
emotional footing — **cut or rewrite it.** A scene that fails this is reported as an `error`:
"appears removable; it has no clear narrative consequence" (`SceneTurnContractValidator.ts:297-303`).
Start scenes as late as possible; leave as soon as the turn, decision, consequence, or handoff lands.

**Prefer turns over topics** (`SceneWriter.ts:440`): a beat should visibly change leverage, trust,
evidence, proximity, identity, risk, resources, or knowledge — never let scenes become chains of
explanation. **Never write a static meeting**; ground any conversation in fitting physical activity so
the power shift or emotional pressure is visible (`SceneWriter.ts:453-454`).

Per non-establishing beat the turn is carried by two structured metadata objects so it is legible both
in prose and to the image agents. `dramaticIntent` is the per-beat turn (`content.ts:141-156`):

```typescript
export interface BeatDramaticIntent {
  characterObjectives?: Record<string, string>; // what each visible character wants, keyed by name/id
  obstacle?: string;                             // what blocks the objective in this exact moment
  statusBefore?: string;                         // who has leverage/control before the turn
  statusAfter?: string;                          // who has leverage/control after the turn
  subtext?: string;                              // the real meaning beneath the surface action/topic
  visibleTurn?: string;                          // the concrete change a viewer reads without captions
  visualSubtextCue?: string;                     // the prop/gesture/distance/posture that reveals subtext
}
```

`sequenceIntent` is the multi-beat storyboard role (`content.ts:158-179`), so consecutive panels read
as **setup → pressure → turn → consequence** rather than unrelated illustrations:

```typescript
export interface NarrativeSequenceIntent {
  objective?: string; activity?: string; obstacle?: string;
  startState?: string; turningPoint?: string; endState?: string;
  visualThread?: string;     // recurring prop/distance/wound/clue/gesture/motif tying panels together
  mechanicThread?: string;   // optional fiction-first hook: trust, leverage, clue, danger, callback...
  sequenceId?: string;
  beatRole?: 'setup' | 'pressure' | 'escalation' | 'turn' | 'consequence' | 'handoff' | 'aftermath';
}
```

Both are **REQUIRED for non-establishing beats** in new multi-beat scenes (`SceneWriter.ts:610-613`);
SceneWriter auto-derives weak/missing ones (`deriveDramaticIntent`, `deriveSceneSequenceIntent`,
`SceneWriter.ts:1792-1946`), but author them well — the derived fallback is generic.

## The SceneCritic rewrite discipline

SceneCritic is the **surgical, optional, config-gated** rewrite pass (`SceneCritic.ts:38-87`). It
rewrites flat / on-the-nose / subtext-poor prose **without changing structure**. Its input/output
shape:

```typescript
export interface SceneCriticInput {
  scene: SceneContent;
  characterBible?: CharacterBible;   // voice profiles (rhythm, lexicon, tics) for voice fidelity
  directorNotes?: string;            // optional steer, e.g. "lean into irony"
  flaggedBeatIds?: string[];         // beats the caller already considers weak
}

export interface SceneCritique {
  sceneId: string;
  rewrittenBeats: GeneratedBeat[];   // ONLY the beats actually rewritten
  critiqueNotes: Array<{ beatId: string; issue: string; fix: string }>;
  overallCommentary: string;
}
```

**Priorities** (`SceneCritic.ts:53-61`): (1) show-don't-tell — replace declarative emotion ("she was
angry") with behavior ("she set the glass down too carefully"), **never add new plot**; (2) subtext
over declaration — irony, deflection, contradiction; (3) **micro-reversal** when a beat drifts — invert
expectation (the threat turns funny, the ally turns guarded, the safe room turns claustrophobic);
(4) voice fidelity, no cross-voice bleed (honors the `voiceProfile` rhythm/lexicon/tics passed via the
character bible, `SceneCritic.ts:126-134`); (5) sensory specificity over abstraction.

**Hard rules** (`SceneCritic.ts:63-68`):

- **Rewrite budget: tighten or loosen prose length up to ±30% only.**
- **Must preserve** beat `id`, `speaker`, `speakerMood`, `plotPointType`, and any `plantsThreadId` /
  `paysOffThreadId` / `twistKind` markers — plus the scene id and choice points.
- **Must not** invent new NPCs, flags, or plot events. **Must not** touch the scene's choice set.
- Only beats actually rewritten go in `rewrittenBeats`; the caller merges them back, leaving untouched
  beats as-is. `normalize()` (`SceneCritic.ts:141-154`) drops any rewritten beat whose id isn't in the
  original scene — so a hallucinated beat id is silently discarded, not merged.

On any error the agent returns `success: true` with empty `rewrittenBeats` (`SceneCritic.ts:104-114`):
it is a best-effort enhancer and must never fail the pipeline.

## StyleArchitect: the visual-style contract

`StyleArchitect` (`agents/StyleArchitect.ts`) expands a free-form art-style string into an enforceable
`ArtStyleProfile`:

```typescript
interface StyleArchitectLlmResponse {
  name?: string;
  renderingTechnique?: string;   // medium, brushwork/pixel density, edge softness — one sentence
  colorPhilosophy?: string;      // palette behavior, saturation, how colors relate — one sentence
  lightingApproach?: string;     // light quality, shadow behavior, atmosphere — one sentence
  lineWeight?: string;           // outlines, linework, line variance — one sentence
  compositionStyle?: string;     // framing conventions, depth, camera feel — one sentence
  moodRange?: string;            // emotional register and tonal defaults — one sentence
  positiveVocabulary?: string[];      // 1-3 word cues that reinforce the style
  inappropriateVocabulary?: string[]; // 1-3 word cues that CONTRADICT it (stripped)
  genreNegatives?: string[];          // negative-prompt cues specific to this style
}
```

Its rules (`StyleArchitect.ts:60-66`): **treat the user's string as authoritative — never substitute a
more familiar style**; each DNA field is one sentence on its own dimension with no repeated phrasing;
total output under ~200 tokens; **never emit cinematic cliches** ("cinematic", "dramatic",
"emotionally charged", "sharp focus") unless the style literally is cinematic live-action. On failure
or unusable output it falls back to `buildVerbatimProfile` (echoes the user's words back, a safe
default that never overrides them — `StyleArchitect.ts:76-101,148-159`). A static in-process cache
keyed on `style::genreHint` makes repeat calls free.

**Why this matters to prose:** SceneWriter's visual-metadata fields **must not fight the active
`ArtStyleProfile`** — avoid generic style words (cinematic, hyperreal, painterly, gritty, etc.) unless
they come from the style contract (`SceneWriter.ts:463-464`). The `SceneCraftValidator` enforces this
with a `STYLE_FIGHTING_TERMS` list (`SceneCraftValidator.ts:46-62`: cinematic, hyperreal, photoreal,
painterly, anime, "dramatic lighting", "high contrast", "vivid colors", gritty, glossy, bokeh, "ultra
detailed", realistic…) and warns when image-facing text uses one that isn't in the active
`allowedStyleTerms`/`styleContextText`.

## Validator severities (what gets enforced vs. flagged)

When you change a craft rule, match the enforcement tier:

- **`error`** (blocks / forces a retry) — the four scene-turn elements, the power-dynamic shift on
  major/high-pressure planned scenes, and the removability/consequence test
  (`SceneTurnContractValidator.ts:257-303`).
- **`warning`** (flagged, doesn't block) — most prose-quality signals in `SceneCraftValidator`: beat
  count outside the configured range, missing `sceneTakeaways`/`keyMoments`, takeaways disconnected
  from keyMoments, non-rest scene with no concrete turn, flat arc (≥3 beats, no `dominant` beat and no
  pointed final beat), weak sensory grounding, explanatory/subtext-poor dialogue, jeopardy dialogue
  too casual, and visual metadata that fights the art style
  (`SceneCraftValidator.ts:249-466`; `passed` is `!issues.some(i => i.severity === 'error')`).

`pipeline-validation` owns the orchestration and retry loop; this skill owns *what the rules mean*.

## See also

- `story-structure-rules` — the season/scene-graph scale: spine, branching, choice taxonomy, stakes.
- `story-playback` — the runtime side of the fiction-first rule (engine, `gameStore`).
- `pipeline-validation` — the validators that protect these craft rules in the retry loop.
- `docs/STORY_QUALITY_CONTRACT.md` — the canonical fiction-first contract.
- Source: `src/ai-agents/agents/SceneWriter.ts`, `agents/SceneCritic.ts`, `agents/StyleArchitect.ts`,
  `prompts/storytellingPrinciples.ts`, `prompts/storyQualityContract.ts`,
  `validators/SceneCraftValidator.ts`, `validators/SceneTurnContractValidator.ts`,
  `src/types/content.ts`.
