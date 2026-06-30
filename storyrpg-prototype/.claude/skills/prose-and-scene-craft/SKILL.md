---
name: prose-and-scene-craft
description: Use this skill for StoryRPG's sentence- and scene-level craft rules — fiction-first prose discipline (no exposed stats/dice/percentages/DCs), narrative-intensity tiering (dominant/supporting/rest beats), show-don't-tell + subtext, sensory specificity, the scene-turn contract, the removability test, and the SceneCritic rewrite pass. Reach for it when working on SceneWriter, SceneCritic, StyleArchitect, or the prose side of ChoiceAuthor.
---

# Prose and Scene Craft

The craft contract the generation pipeline authors against. These are the rules agent prompts
enforce and `pipeline-validation` validators protect — change the rule here and the prompt/validator
together, never one in isolation. (This is the *sentence- and scene-level how-to-write*;
`story-structure-rules` is the *what-to-author* at season/scene-graph scale.)

The trigger agents: **SceneWriter** drafts beats, **SceneCritic** does the optional surgical rewrite,
**StyleArchitect** sets the visual-style contract, and **ChoiceAuthor** writes the choice prose that
must honor the same fiction-first rules.

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

Diegetic legibility (from `FICTION_FIRST_GAME_FEEL`): prefer **risk/leverage framing** the player can
feel — "steady", "desperate", "they trust you", "you're out of your depth" — over any surfaced score.

> The player-facing side of this rule is also documented from the runtime in `story-playback` and in
> `docs/STORY_QUALITY_CONTRACT.md`. Reference those — don't duplicate the runtime enforcement here.

## Narrative-intensity tiering

From `NARRATIVE_INTENSITY_RULES` (`prompts/storytellingPrinciples.ts:360-381`). A scene is a musical
phrase: it needs dominant notes, supporting notes, and rests. **Every scene must vary its beat
intensity — a scene where every beat hits at the same level is a failure.** Every beat carries an
`intensityTier` field (`"dominant" | "supporting" | "rest"`), and it is **REQUIRED** per the Beat
Visual Contract (`SceneWriter.ts:613`).

| Tier         | Per scene   | What it does                                                              |
| ------------ | ----------- | ------------------------------------------------------------------------ |
| `dominant`   | 1–2         | Peak drama: strongest selective sensory detail, highest emotional pressure, most vivid action. Climaxes, confrontations, betrayals, triumphs — written so the reader feels it in the body. |
| `supporting` | majority    | Advance the plot: active prose, forward momentum, clear actions/reactions, standard length. The engine of the story. |
| `rest`       | 1–2         | Breathing room: shorter prose, environmental/atmospheric, quieter. A character processing, a mood-setting detail, stillness before the next escalation — making the dominant beats land harder. |

**Beat-sequence shape (pacing arc):** open with a **supporting or rest** beat to orient the reader →
build through **supporting** beats → hit one **dominant** peak → follow with a **rest** beat to let it
land → build again if there's a second peak → **end on a supporting or dominant** beat leading into the
choice/transition.

Tier-bound length caps live in the Beat Structure section (`SceneWriter.ts:500-523`): standard beats
cap at the configured `maxSentences`/`maxWords` (target 2–3 sentences); `isClimaxBeat: true` raises the
cap to `TEXT_LIMITS.maxClimaxBeatWordCount` (max 1–2 per scene); `isKeyStoryBeat: true` raises it to
`TEXT_LIMITS.maxKeyStoryBeatWordCount` (max `TEXT_LIMITS.maxKeyStoryBeatsPerScene` per scene). Short
beats are deliberate — mobile screens, tap-to-advance interactivity. **Do not write paragraphs.**

## Show-don't-tell + subtext

SceneWriter's "Prose And Dialogue Craft" and `CRAFT_PRESSURE_GUIDANCE`
(`storytellingPrinciples.ts:407-409`):

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

## Sensory specificity

From "Prose And Dialogue Craft" (`SceneWriter.ts:467-470`):

- **Sensory detail is selective and purposeful** — it establishes place, mood, danger, intimacy,
  texture, or consequence. **Do not force all five senses into every beat.**
- Description must be **dynamic**: details carry pressure, mood, threat, desire, consequence, movement,
  or contrast — not static scenery.
- "Vivid" means **specific story intent, sensory clarity, emotional legibility, image-safe detail** —
  not ornate prose or conflicting art direction. Avoid abstract-only phrases ("tension rises",
  "emotion deepens"); describe what is physically visible, always using character names.
- Vary sentence rhythm with pressure: shorter/sharper under danger or fear; slightly longer for
  atmosphere, aftermath, tenderness, or dread (within mobile beat caps).

## The scene-turn contract

From `CORE_DRAMATIC_STRUCTURE_RULES` (`storytellingPrinciples.ts:463-475`), reinforced in SceneWriter's
"Scene Authorship" rules. **Every scene must satisfy:**

1. **Entry intent** — a character wants something on entry.
2. **Active obstacle** — something resists that intent.
3. **Forced decision** — a visible player choice, character commitment, refusal, revelation,
   sacrifice, tradeoff, or irreversible reaction.
4. **Exit shift** — changed footing on the way out.

Rest and aftermath scenes still need intent, resistance, and changed footing.

**Power-dynamic shift:** in multi-character scenes, the power dynamic must shift **at least once** —
leverage, trust, vulnerability, intimacy, distance, status, information, threat, debt, or
public/private advantage changes hands (`storytellingPrinciples.ts:468-470`; `SceneWriter.ts:434`).

**Removability test:** if removing a scene changes no information, relationship, identity,
resource/access, danger, promise, payoff, choice consequence, theme pressure, stakes, route state, or
emotional footing — **cut or rewrite it.** Start scenes as late as possible; leave as soon as the turn,
decision, consequence, or handoff lands.

**Prefer turns over topics** (`SceneWriter.ts:440`): a beat should visibly change leverage, trust,
evidence, proximity, identity, risk, resources, or knowledge — never let scenes become chains of
explanation. **Never write a static meeting**; ground any conversation in fitting physical activity so
the power shift or emotional pressure is visible (`SceneWriter.ts:453-454`).

Per non-establishing beat this is carried by structured fields — `dramaticIntent` (objective, obstacle,
statusBefore/After, subtext, `visibleTurn`, `visualSubtextCue`) and `sequenceIntent` (objective,
activity, obstacle, startState/turningPoint/endState, visualThread, beatRole) — so the turn is legible
both in prose and to the image agents (`SceneWriter.ts:610-641`).

## The SceneCritic rewrite discipline

SceneCritic is the **surgical, optional, config-gated** rewrite pass (`SceneCritic.ts:43-86`). It
rewrites flat / on-the-nose / subtext-poor prose **without changing structure**.

**Priorities:** (1) show-don't-tell — replace declarative emotion ("she was angry") with behavior ("she
set the glass down too carefully"), **never add new plot**; (2) subtext over declaration — irony,
deflection, contradiction; (3) **micro-reversal** when a beat drifts — invert expectation (the threat
turns funny, the ally turns guarded, the safe room turns claustrophobic); (4) voice fidelity, no
cross-voice bleed; (5) sensory specificity over abstraction.

**Hard rules:**

- **Rewrite budget: tighten or loosen prose length up to ±30% only.**
- **Must preserve** beat `id`, `speaker`, `speakerMood`, `plotPointType`, and any `plantsThreadId` /
  `paysOffThreadId` / `twistKind` markers — plus the scene id and choice points.
- **Must not** invent new NPCs, flags, or plot events. **Must not** touch the scene's choice set.
- Only beats actually rewritten go in `rewrittenBeats`; the caller merges them back, leaving untouched
  beats as-is. `normalize()` drops any rewritten beat whose id isn't in the original scene.

## StyleArchitect: the visual-style contract

`StyleArchitect` (`agents/StyleArchitect.ts`) expands a free-form art-style string into an enforceable
`ArtStyleProfile` (renderingTechnique, colorPhilosophy, lightingApproach, lineWeight, compositionStyle,
moodRange, plus positive/inappropriate/negative vocab). Its rules: **treat the user's string as
authoritative — never substitute a more familiar style**; each DNA field is one sentence on its own
dimension; total output under ~200 tokens; **never emit cinematic cliches** ("cinematic", "dramatic",
"emotionally charged", "sharp focus") unless the style literally is cinematic live-action. On failure
it falls back to `buildVerbatimProfile` (echoes the user's words). This matters to prose because
SceneWriter's visual-metadata fields **must not fight the active `ArtStyleProfile`** — avoid generic
style words (cinematic, hyperreal, painterly, gritty, etc.) unless they come from the style contract
(`SceneWriter.ts:463-464`).

## See also

- `story-structure-rules` — the season/scene-graph scale: spine, branching, choice taxonomy, stakes.
- `story-playback` — the runtime side of the fiction-first rule (engine, `gameStore`).
- `pipeline-validation` — the validators that protect these craft rules in the retry loop.
- `docs/STORY_QUALITY_CONTRACT.md` — the canonical fiction-first contract.
- Source: `src/ai-agents/agents/SceneWriter.ts`, `agents/SceneCritic.ts`, `agents/StyleArchitect.ts`,
  `prompts/storytellingPrinciples.ts`, `prompts/storyQualityContract.ts`.
