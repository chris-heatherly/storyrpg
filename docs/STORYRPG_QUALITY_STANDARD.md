# StoryRPG Quality Standard

**Status:** Canonical author/critic reference for story, branching, gameplay, characters, NPCs, media, and validation.
**Audience:** Story authors, pipeline agents, validators, reviewers, and anyone deciding whether generated content is "good enough."

This document defines what "good" and "quality" mean for StoryRPG. It consolidates the design intent from the GDD, TDD, story quality contract, branching rules, pipeline prompting contract, season canon work, and validator architecture into one usable standard.

StoryRPG quality is not just "nice prose." A high-quality StoryRPG story is:

- Good fiction: coherent, specific, emotionally legible, paced, surprising, and satisfying.
- Good interactive fiction: player choices matter, branch residue survives reconvergence, and consequences feel authored.
- Good RPG design: hidden mechanics create fair, expressive, fiction-first pressure.
- Good generation output: every artifact fits the canonical data model and can be validated, resumed, repaired, and played.
- Good reader experience: the player sees a polished full-screen story, never scaffolding, stats, debug language, or generation seams.

## The Author/Critic Loop

Use this document in two passes.

**Author pass:** Build the story as if you are responsible for an intentional work of fiction. Make strong choices. Ground every system in character, conflict, cost, and consequence.

**Critic pass:** Audit the work as if you are trying to prove it is hollow. Ask whether choices are cosmetic, branches are fake, NPCs are flat, mechanics leak, payoffs are unearned, images fail the beat, or artifacts cannot be replayed.

The work is good only when it survives both passes.

## Non-Negotiable Quality Pillars

### 1. Fiction first

The player never sees stats, dice, thresholds, DCs, modifiers, success percentages, build language, or system math. Mechanics are expressed as risk, leverage, preparation, hesitation, fatigue, trust, reputation, identity pressure, physical cost, social cost, or altered opportunity.

**Author standard**

- Write every mechanic as something true in the world.
- Let attributes and skills change what the character notices, attempts, risks, recovers from, or pays for.
- Use hidden numbers only to produce consistent narrative outcomes.
- Show consequences through prose, dialogue, staging, visual state, route changes, and NPC behavior.

**Critic checks**

- Does any player-facing text include banned terms such as stat, skill check, threshold, roll, modifier, bonus, success chance, failure chance, percentage, level requirement, or build?
- Could the player infer what changed from the fiction alone?
- Does a failed check create playable pressure, or does it merely say "you failed"?
- Does preparation matter without turning the story into optimization?

### 2. Meaningful agency

Every meaningful choice must affect at least one of the five impact factors: outcome, process, information, relationship, or identity. Rich choices usually affect two or three.

**Author standard**

- Give the player enough context to roleplay intent.
- Make choice text express a real action, stance, risk, or value.
- Attach immediate or delayed residue to meaningful choices.
- Reserve pure flavor for expression choices, and keep those honest: flavor may shape tone or identity, but it must not pretend to be structural.

**Critic checks**

- If this choice were removed, would anything meaningful change?
- Does each non-flavor choice change what happens, how it happens, what is learned, how someone feels, or who the protagonist becomes?
- Are dilemma choices genuinely value conflicts rather than obvious right answers?
- Are blind choices fair, with enough fictional signal that trust is preserved?

### 3. Authored coherence

The story must feel designed, not accumulated. Scenes should connect by "therefore" or "but," not "and then."

**Author standard**

- Each scene changes what someone wants, knows, risks, controls, owes, fears, or believes.
- Major turns are caused or meaningfully reshaped by player/protagonist action.
- Escalation follows from choices, consequences, antagonist pressure, environmental pressure, revealed information, or relationship rupture.
- Surprise is earned by setup; payoff is surprising now and inevitable in retrospect.

**Critic checks**

- Could scenes be shuffled without breaking causality? If yes, the structure is weak.
- Does the protagonist mostly react to events, or do their choices drive the story?
- Is any climax solved by rescue, coincidence, prophecy, sudden competence, or arbitrary arrival?
- Does every major reveal have a prior plant?

### 4. Playable completeness

Quality includes shipping a complete playable artifact. A beautiful but broken story is not good.

**Author standard**

- Generated output must conform to the canonical `Story -> Episode -> Scene -> Beat -> Choice` model.
- Every route must be reachable, playable, and able to continue.
- Every image/audio/video reference must resolve or degrade gracefully.
- `story.json` and `manifest.json` are the primary package contract; legacy mirrors are compatibility only.

**Critic checks**

- Can a reader load the story from disk through the catalog?
- Are all scene IDs, beat IDs, `nextSceneId`s, and `nextBeatId`s valid?
- Is any scene unreachable or any route a dead end?
- Do all generated artifacts remain reader-safe and free of provider secrets, prompts, checkpoints, and diagnostics?

## Story Structure

### Season quality

A good season is a complete dramatic unit. It may leave future pressure, but it must satisfy the promise it made.

**Author standard**

- Define a season dramatic question centered on the protagonist/player.
- Define central pressure: a person, institution, mystery, environment, relationship, internal force, or situation.
- Define the promise of the premise: what kind of play, emotion, conflict, and variation the season offers.
- Resolve the season question, stakes, and character state enough that the season feels complete.
- Future hooks must not erase satisfaction.

**Critic checks**

- Can the season be summarized as a protagonist-facing question?
- Does Episode 1 clearly establish the premise, player role, dramatic engine, and emotional promise?
- Does the finale answer, reframe, or resolve the main pressure?
- Are future hooks earned and optional, rather than a substitute for resolution?

### Seven-point structure

The seven-point spine is load-bearing: `hook`, `plotTurn1`, `pinch1`, `midpoint`, `pinch2`, `climax`, and `resolution`.

**Author standard**

- Carry source anchors forward: stakes, goal, inciting incident, and climax.
- Map the seven-point beats across the requested episode count.
- Make each episode serve its assigned structural role.
- When an episode carries a pinch, pressure the stakes directly.
- When an episode carries the climax, land the same event promised by the climax anchor.

**Critic checks**

- Are all seven structural beats present and in monotonic order?
- Do the beats pressure the same story, or do they feel like disconnected episodes?
- Does the midpoint recontextualize the problem, not merely raise volume?
- Does the resolution show what changed?

### Arc quality

Arcs are pressure movements inside a season, not competing formulas.

**Author standard**

- Give each arc a question related to the season question.
- Give each arc an identity pressure facet: belief, wound, vow, loyalty, ambition, self-image, fear, or value conflict.
- Give each arc a midpoint recontextualization, late crisis, finale answer, and handoff pressure when applicable.
- Ensure each episode leaves damage, knowledge, obligation, exposure, compromise, relationship pressure, choice residue, or future pressure.

**Critic checks**

- Are episodes inside an arc reorderable? If yes, the arc is too flat.
- Does the arc ask a narrower version of the season question?
- Does the late arc crisis change available options?
- Does an arc ending either resolve its question or hand forward sharper pressure?

### Episode quality

A good episode has its own dramatic shape while moving the season.

**Author standard**

- Establish an episode question or active pressure early.
- Provide a self-contained beginning, turn, pressure peak, and changed end state.
- Target a strong rhythm: reading, choice, consequence, encounter, aftermath, and forward pressure.
- Include meaningful relationship, identity, competence, and consequence opportunities.
- For non-finales, end with next-episode pressure, a cliffhanger, a cost, or a changed state.

**Critic checks**

- Does the opening promise active pressure within the first scene or first beats?
- Does the episode answer, complicate, or reframe its question?
- Does the ending leave the player somewhere different emotionally, relationally, strategically, materially, or morally?
- Are there 12-18 meaningful choices in a standard episode target, with choices appearing often enough to sustain engagement?
- Are encounters placed for dramatic rhythm rather than because the system requires one?

### Scene quality

A good scene is not a container. It is a turn.

**Author standard**

- Enter with an objective, desire, question, or pressure.
- Name the obstacle or resistance.
- Force a decision, commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.
- Exit with changed information, relationship, identity, access, danger, promise state, route state, or emotional footing.
- In multi-character scenes, shift power, trust, distance, leverage, intimacy, status, or vulnerability.

**Critic checks**

- What does the protagonist want at scene start?
- What resists them?
- What changes by scene end?
- Could the next scene begin the same way if this scene were removed?
- Does the scene contain subtext, physical business, and concrete action, or only explanation?

### Beat quality

A good beat is a readable moment: one image-backed unit of prose with a job.

**Author standard**

- Keep beats focused: a paragraph-scale action, perception, dialogue exchange, reveal, choice, or consequence.
- Use concrete detail and active verbs.
- Make dialogue sound like character behavior, not exposition transport.
- Give visual beats enough action, emotion, relationship, and staging to be illustratable.
- Use text variants for callbacks and state-specific recognition.

**Critic checks**

- What is this beat doing that the previous beat did not do?
- Can the image team understand the visual moment without guessing?
- Does dialogue reveal motive, pressure, tactic, status, or concealment?
- Is there filler prose that delays the turn without increasing tension or meaning?

## Player Character Quality

The player character is not a visible stat sheet. They are an emerging identity shaped through pressure.

### Player identity

The hidden identity profile has six spectrums:

- Mercy <-> Justice
- Idealism <-> Pragmatism
- Cautious <-> Bold
- Loner <-> Leader
- Heart <-> Head
- Honest <-> Deceptive

**Author standard**

- Choices should reveal or shape these dimensions through action, tone, sacrifice, relationship behavior, and recurring patterns.
- Identity-gated options should feel like natural expressions of who the player has become.
- Identity shifts must be earned by behavior, not assigned by the narrator.
- The player should recognize their character through recurring tendencies and consequences, not through labels.

**Critic checks**

- Do major identity changes come from meaningful choices?
- Are identity-gated options written as natural prose, not system rewards?
- Does the story remember the player's pattern across episodes?
- Do dilemma choices pressure values rather than merely test morality slogans?

### Attributes and skills

The six hidden attributes are charm, wit, courage, empathy, resolve, and resourcefulness. Skills are genre-specific competencies.

**Author standard**

- Use attributes as fiction lenses: how the protagonist persuades, notices, endures, improvises, risks, or understands.
- Use skills as genre language: hacking, sword fighting, diplomacy, surveillance, ancient lore, etc.
- Surface competence through passive insights, prepared advantages, choice affordances, outcome texture, and branch residue.
- Higher-difficulty checks need fictional support, such as clues, items, relationships, prior failures, mentorship, promises, or leverage.

**Critic checks**

- Are skills distributed across the episode so one build does not own the whole story?
- Do checks above normal difficulty have prior fictional support?
- Does failure teach, cost, expose, injure, complicate, or redirect?
- Can a low-skill player still continue through a worse but playable route?

### Progression

Growth is experiential, not displayed.

**Author standard**

- Let repeated behavior improve hidden attributes and skills.
- Let failure provide learning and pressure.
- Slow growth near high competence.
- Show growth through new confidence, insights, options, recovery, or NPC recognition.

**Critic checks**

- Does the player feel more capable over time without seeing numbers?
- Are growth moments tied to use, risk, or consequence?
- Does progression preserve tension rather than erasing it?

## NPC and Relationship Quality

NPCs are not quest dispensers. They are pressure-bearing characters with motives, memory, voice, and change.

### NPC depth tiers

**Core NPCs** are antagonists, major allies, romantic leads, rivals, mentors, and recurring emotional anchors. They require all four relationship dimensions: trust, affection, respect, and fear.

**Supporting NPCs** are recurring quest givers, witnesses, faction members, and relationship pressure characters. They require at least two relevant dimensions.

**Background NPCs** are one-scene or low-presence characters. They require at least one dimension or a clear function if tracked.

**Author standard**

- Every named NPC should have a want, fear, flaw, voice profile, and role in the pressure architecture when important enough.
- Core and supporting NPCs need protagonist-visible signals of their inner pressure.
- NPCs should react to the player's choices through trust, affection, respect, fear, secrets, offers, refusals, distance, vulnerability, or risk.
- NPC arcs should have start states, key beats, and end states when they recur.

**Critic checks**

- Can this NPC want something even when the protagonist is absent?
- Does this NPC's voice differ in syntax, vocabulary, rhythm, and emotional tactics?
- Do relationship changes alter behavior, not just stored numbers?
- Does an NPC remember specific prior interactions?
- Are secrets planted, revealed, and paid off intentionally?

### Relationship dimensions

**Trust** means reliability. **Affection** means personal warmth. **Respect** means perceived competence. **Fear** means perceived danger.

**Author standard**

- Track dimensions separately. An NPC can respect the player but distrust them, like them but fear them, or trust them without agreeing.
- Use relationship state for conditional text, altered tone, available help, betrayal risk, locked options, storylets, and later callbacks.
- Make relationship shifts proportional and specific.

**Critic checks**

- Does the story collapse all relationship changes into generic approval?
- Are contradictory states handled with nuance?
- Are relationship consequences visible later?
- Does reconvergence acknowledge relationship differences?

## Choice Quality

### Choice types

Choice type describes the player experience, not the route effect.

- `expression`: personality, voice, tone. Never branches.
- `relationship`: social stance or bond pressure. May branch.
- `strategic`: competence, tactics, or practical problem-solving. May branch.
- `dilemma`: value conflict with no clean answer. May branch.

Target distribution across an episode is roughly 20 percent expression, 25 percent relationship, 30 percent strategic, and 25 percent dilemma.

**Author standard**

- Expression choices may personalize tone and identity but must never include `nextSceneId`.
- Relationship choices should alter at least one relationship dimension or future behavior.
- Strategic choices should make approach and risk clear without exposing math.
- Dilemmas should force a real tradeoff between values, people, costs, duties, or futures.

**Critic checks**

- Is the stated choice type honest?
- Does any expression choice route to a different scene? That is invalid.
- Are strategic choices just synonyms for "do the obvious thing"?
- Are dilemmas emotionally and morally symmetrical enough to be interesting?

### Stakes triangle

Every meaningful choice needs want, cost, and identity.

**Author standard**

- Want: the goal the player understands.
- Cost: what is risked, sacrificed, lost, exposed, delayed, or damaged.
- Identity: what the choice says about who the protagonist is becoming.

**Critic checks**

- Can the player tell what they are trying to achieve?
- Is there a real price?
- Does the choice reveal character?
- Is the cost proportional to the reward?

### Consequence tiers

Use the smallest tier that honors the moment.

- Callback line: cheap, frequent, high value.
- Scene tint: same scene, altered flavor, dialogue, description, or option.
- Branchlet: unique scene or substantial sequence for important choices.
- Structural branch: major route, climax, or ending-level divergence.

**Author standard**

- Spend structural branches only on major turns.
- Use callbacks and tints liberally to preserve memory.
- Let branchlets feel distinct, not like renamed copies.
- Attach memorable moments to choices worth recalling.

**Critic checks**

- Is the consequence budget proportional?
- Are expensive branches reserved for choices players will remember?
- Does reconverged content still acknowledge the branch?
- Are delayed consequences timed to maximize recognition?

### Mechanical storytelling metadata

Good choices can carry `storyVerb`, `affordanceSource`, `witnessReactions`, `failureResidue`, `visualResidueHint`, `reminderPlan`, `feedbackCue`, `moralContract`, and `residueHints`.

**Author standard**

- `storyVerb` should name the fiction action: threaten, confess, bargain, protect, expose, betray, improvise.
- `affordanceSource` should explain why the option exists: identity, relationship, tag, item, skill, flag, or callback.
- Witness reactions should make other characters remember and judge.
- Failure residue should become later story material.

**Critic checks**

- Is the mechanical residue visible in prose or future routes?
- Do witnesses react in a way that changes social reality?
- Does the failure residue have a later use, cost, or callback?

## Branching Quality

StoryRPG uses branch-and-bottleneck structure: bottleneck -> branch zone -> bottleneck -> branch zone -> bottleneck.

### Branch rules

**Author standard**

- Branching is created by choices with `nextSceneId`, not by choice type.
- A choice branch target must exist in the parent scene's `leadsTo`.
- All branches must reconverge at bottlenecks.
- No dead ends. No unreachable scenes. No orphan branches.
- Maximum two branching choice points per standard episode, with encounter branching on top.
- Encounter and storylet branching do not satisfy regular scene-graph branch requirements by themselves.

**Critic checks**

- Does each branch path show genuinely different experience?
- Does every branch eventually reach a planned bottleneck?
- Does reconvergence acknowledge the path taken?
- Are branch outcomes mechanically and narratively distinct, or just cosmetic?
- Does branch tone survive in later descriptions, NPC behavior, or visual state?

### Reconvergence

Reconvergence is not erasure.

**Author standard**

- Reconcile conflicting flags, scores, relationships, injuries, items, knowledge, and NPC states.
- Use conditional text or variants to acknowledge prior path.
- Preserve route residue through callbacks, altered tone, visual details, or future affordances.
- Ensure every valid path can continue from the bottleneck.

**Critic checks**

- Does the bottleneck read identically for players who made opposed choices?
- Are impossible state combinations handled?
- Does the story know what the player did before merging routes?

### Cross-episode branching

Cross-episode branches should alter future content without exploding the whole season.

**Author standard**

- Use flags, text variants, relationship behavior, scene tints, altered options, and conditional payoffs.
- Classify impact as major, moderate, or minor.
- Major cross-episode effects need explicit plan, payoff target, and reconvergence strategy.

**Critic checks**

- Does the later episode check the flag it claims to care about?
- Is a "major" impact actually more than a line change?
- Are conditions readable, valid, and reachable?

## Encounter Quality

Encounters are the primary tactical branching mechanism. They turn hidden character capability into kinetic drama.

### Encounter structure

A good encounter has type, style, objective, clocks, phases, beats, tactical choices, outcome branches, visible cost, and aftermath.

Encounter types include combat, chase, heist, negotiation, investigation, survival, social, romantic, dramatic, puzzle, exploration, stealth, and mixed.

Encounter styles include action, social, romantic, dramatic, mystery, stealth, adventure, and mixed.

**Author standard**

- Define the goal clock, threat clock, and optional complication clocks in fiction-first terms.
- Structure phases as setup, rising pressure, peak, and resolution.
- Give choices an approach: aggressive, cautious, clever, desperate, or adaptive.
- Pre-author success, complicated, and failure outcomes.
- Let outcomes produce different next situations where appropriate.
- Terminal outcomes should map to victory, partial victory, defeat, or escape.

**Critic checks**

- Does the encounter have a clear objective and escalating threat?
- Are success, complication, and failure all playable?
- Do clocks represent fiction pressure, not exposed math?
- Does each approach feel different?
- Does the encounter end with consequences, not a hard reset?

### Partial victory

Partial victory must not collapse into victory.

**Author standard**

- Give partial victory a structured cost: domain, severity, who pays, immediate effect, visible complication, lingering effect, and optional consequences.
- Make the cost visible in prose and `visualContract.visibleCost`.
- Route to a partial-victory storylet or explicit next scene.

**Critic checks**

- What did the player win?
- What did they pay?
- Who can see the cost?
- Does the cost matter later?

### Storylets

Storylets are aftermath, not filler.

**Author standard**

- Write 1-3 or 3-5 beat aftermath sequences depending on context.
- Give victory, partial victory, defeat, and escape distinct tone and consequences.
- Set flags and relationship changes that support later callbacks.
- Use storylets to transition emotionally back to the main plot.

**Critic checks**

- Does each outcome have a distinct aftermath?
- Does the storylet acknowledge tactical choices?
- Does it create future material?

## Game System Quality

### State architecture

StoryRPG state has three layers:

- Flags: booleans for simple gates.
- Scores: integers for reputation, resources, relationship values, and thresholds.
- Tags: flexible sets for identity markers, learned knowledge, allies, locations, and complex conditions.

**Author standard**

- Use flags for clear yes/no facts.
- Use scores for accumulative pressure.
- Use tags for identity, discovered facts, affiliations, and flexible state.
- Name state clearly enough that future agents can understand it.
- Do not create state that never gates, colors, pays off, or appears in future logic.

**Critic checks**

- Is each state variable used later?
- Are names specific and stable?
- Are conditions reachable?
- Are path-conditional facts kept separate from always-true canon?

### Conditions

Conditions may check attributes, skills, relationships, flags, scores, tags, items, or identity. They may be combined with and/or/not logic.

**Author standard**

- Use conditions to reveal earned affordances, not to punish players with opaque locks.
- Locked choices need fiction-first locked text when shown.
- Hide choices when revealing the lock would spoil content or feel gamey.
- Use compound conditions sparingly and legibly.

**Critic checks**

- Can the player understand why an option exists or is unavailable from the story?
- Is the condition possible to satisfy?
- Does a hidden condition remove necessary progress?
- Does a locked option reveal mechanics or spoilers?

### Consequences

Consequences can change attributes, skills, relationships, flags, scores, tags, and inventory.

**Author standard**

- Make consequences proportional, coherent, timed, and connected.
- Pair important immediate consequences with later recognition.
- Use delayed consequences for butterfly-effect memory.
- Give delayed consequences specific source scene/choice context.

**Critic checks**

- Is the consequence believable from the choice?
- Is it too large for a minor moment or too small for a major one?
- Does delayed payoff occur when the player can remember the cause?
- Are all delayed consequences able to fire?

### Inventory and items

Items are narrative tools first.

**Author standard**

- Every item needs a description, story significance, and possible contextual use.
- Items may provide hidden advantages, unlock beats, alter options, be consumed, be given, break, combine, or mark identity.
- Items should reappear when dramatically useful.

**Critic checks**

- Is this item more than a loot label?
- Does it create an affordance, cost, relationship moment, or callback?
- Does an important item vanish from the story's memory?

### Resolution quality

Resolution uses hidden rolls and three-tier outcomes: success, complicated, and failure.

**Author standard**

- Prewrite all outcome texts in genre-appropriate prose.
- Success should advance the goal without being consequence-free by default.
- Complicated success should achieve the goal at cost.
- Failure should create pressure, debt, injury, exposure, lost leverage, suspicion, damaged trust, route pressure, or recovery.

**Critic checks**

- Are all three outcomes distinct?
- Does complicated success have an actual complication?
- Does failure preserve story continuation?
- Does outcome texture reflect attribute, skill, approach, preparation, and prior state?

## Canon, Memory, and Payoff Quality

### Setup and payoff

Every important plant should pay off or be intentionally abandoned with reason.

**Author standard**

- Track promises, clues, foreshadowing, relationship beats, choice consequences, and threads in a ledger.
- Give important promises explicit payoff targets.
- Payoffs must reference real plants.
- Plants must have reachable future payoff windows.
- Payoffs should feel altered by player state where relevant.

**Critic checks**

- Is anything planted and forgotten?
- Is anything paid off without being planted?
- Are payoffs due in this episode actually present?
- Are abandoned threads marked and justified?

### Season canon

The LLM proposes; the canon disposes.

**Author standard**

- Freeze established facts into deterministic artifacts as soon as they are validated.
- Downstream generation reads canon instead of reinventing facts.
- Sealed episode facts are read-only.
- Canon includes character facts, world facts, relationships, knowledge state, and ending drivers.
- Episode state snapshots carry flags, scores, relationships, open promises, and knowledge refs forward.

**Critic checks**

- Does any episode contradict sealed canon?
- Does a character know something before learning it?
- Does regeneration preserve frozen upstream context?
- Can an episode be repaired without regenerating prior sealed episodes?

### Information management

Information is a tension resource.

**Author standard**

- Track who knows what: player/audience, protagonist, ally, antagonist, world.
- Prefer suspense and dramatic irony when they create stronger pressure than mystery.
- Use mystery sparingly and answer it intentionally.
- Major clues, secrets, threats, and open questions need ownership, reveal timing, and payoff.

**Critic checks**

- Are mysteries piling up without closure?
- Does the story confuse player knowledge and protagonist knowledge?
- Are reveals timed for pressure?
- Is the audience withheld from arbitrarily?

## Visual, Audio, and Media Quality

### Visual storytelling

Images are story beats, not decorations.

**Author standard**

- Every image should communicate action, emotion, relationship, and setting without captions.
- Use storyboard sheets and panel metadata as continuity authority.
- Use style profiles to judge whether cinematic depth, contrast, asymmetry, or motion are desirable.
- Maintain character identity, costuming, props, geography, lighting, and relationship blocking.
- Avoid universal defects: accidental text, duplicate intended characters, watermarks, reference-sheet artifacts, default first-person or disembodied POV, identity drift, and mobile-unsafe focal content.

**Critic checks**

- Can the viewer understand what changed in the beat?
- Are visible characters the correct characters?
- Does the image show the cost, relationship, or action that matters?
- Is the focal content safe and readable on mobile?
- Does the art obey the approved style anchors?

### Encounter visuals

Encounter art must preserve the tactical story.

**Author standard**

- Carry `visualContract` through beat setup, outcomes, next situations, and storylets.
- Specify primary action, emotional read, relationship dynamic, visible cost, must-show detail, key expression, gesture, body language, shot, and emotional core when relevant.
- Maintain positions, conditions, props in play, environment changes, and relationship distance across frames.

**Critic checks**

- Can art be generated from the contract without guessing the drama?
- Does partial victory visibly differ from victory?
- Are action continuity and geography legible?

### Audio and narration

Audio is optional but must support comprehension and mood.

**Author standard**

- Narration voices should match character personality, role, and emotional state.
- Ambient audio should support setting without competing with prose.
- Music and undertone should follow emotional pressure.
- Audio must never carry essential information absent from text.

**Critic checks**

- Does narration clarify or flatten the prose?
- Are character voices distinct?
- Can the story be understood with audio off?

## Source, Treatment, and Style Fidelity

### Source fidelity

When source material or a treatment exists, it is binding for load-bearing facts.

**Author standard**

- Preserve explicit source characters, premise, stakes, sequence order, required beats, quotes, settings, and endings unless the user asks to adapt them.
- Transform source material into interactive fiction without losing its core promise.
- Keep source-specific language, motifs, and constraints where they matter.

**Critic checks**

- Did the generated story omit a required beat?
- Did it contradict source facts?
- Did it invent a replacement for a source-specific moment instead of adapting it?
- Are quotes or iconic lines recalled accurately when required?

### Style fidelity

Style should be deliberate, not default cinematic mush.

**Author standard**

- Expand user-supplied style into a structured `ArtStyleProfile`.
- Unknown styles should preserve the user's wording rather than inheriting unrelated cinematic vocabulary.
- Store approved style anchors and reuse them for regeneration.
- Judge visuals against the selected style, not a universal style preference.

**Critic checks**

- Does prose and art match the requested genre, tone, and visual style?
- Did style drift across episodes?
- Are regenerations using the same style contract?

## Validation and Quality Gates

Validation is part of quality, not an afterthought.

### Hard correctness

Hard correctness blocks output when broken:

- Unparseable JSON.
- Invalid canonical data shape.
- Missing required story/episode/scene/beat fields.
- Invalid starting scene.
- Broken scene or beat references.
- Dead ends, orphan branches, unreachable scenes.
- Choice-density floor unmet where required.
- Required encounter missing.
- Partial-victory path missing structured cost.
- Runtime package cannot be loaded.

### Advisory craft and fidelity

Craft/fidelity warnings should be recorded and surfaced, not silently discarded:

- Treatment fidelity concerns.
- Dramatic structure weakness.
- Theme pressure weakness.
- Scene turn weakness.
- Episode pressure weakness.
- Voice or prose quality concerns.
- Over-foreshadowed twist.
- Passive protagonist diagnostics.
- Unmotivated escalation.

The product goal is complete playable stories. Advisory validators should not produce zero output on the final attempt, but their warnings must remain visible.

### Quality bands

The best-practices score uses these bands:

- `ship`: 70 or higher. Good to publish.
- `warn`: 50-69. Publishable but flagged for review.
- `block`: below 50. Needs rework.

### Validator ownership map

Use the validator family that owns the problem:

- Choice impact: `ChoiceImpactValidator`.
- Mechanics leakage: `MechanicsLeakageValidator`.
- Stat-check balance: `StatCheckBalanceValidator`.
- Skill surfaces: `SkillSurfaceValidator`.
- Skill/attribute coverage: `SkillCoverageValidator`.
- Branch mechanical residue: `BranchMechanicalDivergenceValidator`.
- Mechanical metadata: `MechanicalStorytellingValidator`.
- Callback coverage: `CallbackCoverageValidator`, `CallbackOpportunitiesValidator`.
- Consequence budget: `ConsequenceBudgetValidator`.
- Branch graph validity: `SceneGraphBranchValidator`, `DivergenceValidator`.
- Setup/payoff: `SetupPayoffValidator`.
- Twist and surprise: `TwistQualityValidator`, `PixarPrinciplesValidator`.
- Character change: `ArcDeltaValidator`, `SceneCraftValidator`.
- NPC depth: `NPCDepthValidator`, `CharacterArchitectureValidator`.
- Seven-point structure: `SevenPointCoverageValidator`, `SevenPointAnchorConformanceValidator`.
- Source/treatment fidelity: `TreatmentFidelityValidator`, quote recall diagnostics.
- Sequence continuity: `sequencePlanSpecificityAudit`, `sequenceContinuityAudit`, `turnAudit`.
- Visual defects: storyboard-v2 QA, image defect gates, `VisualQualityJudge`, visual checks.
- Asset reachability: `storyAssetWalker`.
- Runtime playability: `storyPathAnalyzer`, Playwright multi-path QA.

## Failure Mode Checklist

Use these diagnoses in critic pass:

- Escalation trap: stakes grow faster than investment.
- Mystery box collapse: unanswered questions accumulate without payoff.
- Character drift: behavior or voice changes without pressure.
- Passive protagonist: major turns happen to the player rather than through them.
- Theme drift: plot events stop testing the central question.
- Unmotivated escalation: pressure rises without causal source.
- Convenient coincidence: solution arrives from luck, rescue, prophecy, or arbitrary timing.
- Telegraphed twist: clues repeat so plainly that the reveal is obvious.
- Cheating twist: reveal contradicts prior facts or hides required information unfairly.
- Cosmetic branching: paths look different but change nothing.
- Reset disease: emotional, relational, or world state snaps back after consequences.
- Mechanics leakage: prose names hidden systems.
- Visual mismatch: image contradicts prose, character identity, cost, or style.
- Canon contradiction: later output overwrites sealed facts.

## Definition of Done for a Story Package

A StoryRPG story is quality-complete when all of the following are true:

1. It is playable from catalog load through episode completion.
2. It follows the canonical story data model.
3. It preserves source/treatment requirements.
4. It has a season promise, central pressure, seven-point structure, episode roles, and a satisfying completion plan.
5. Every episode has a question, pressure turn, changed end state, and appropriate forward pressure.
6. Every scene has objective, obstacle, turn, and exit shift.
7. Every meaningful choice passes the five-factor test and stakes triangle.
8. Expression choices never branch.
9. Branches are reachable, meaningful, and reconverge without erasing residue.
10. Encounters have clocks, phases, distinct outcomes, visible costs, and aftermath.
11. Player identity, attributes, skills, relationships, inventory, flags, scores, and tags are used fiction-first.
12. Core NPCs have motives, voice, relationship dimensions, memory, and arcs.
13. Consequences are proportional, coherent, timed, connected, and able to pay off.
14. Setup/payoff, twist, information, and canon ledgers have no unplanned dangling obligations.
15. Visuals support the beat, preserve continuity, and obey style.
16. Audio, when present, supports rather than replaces text.
17. Hard validators pass.
18. Advisory warnings are recorded with enough detail for review or repair.
19. Asset HTTP checks and runtime playthrough QA pass or are explicitly skipped for an acceptable environment reason.
20. Reader export remains free of generator code, secrets, prompts, checkpoints, job state, source uploads, LoRA artifacts, and diagnostics.

## Author/Critic Operating Procedure

Use this sequence for any new generated story, repair, or major story-system change.

### Author pass

1. Define the source promise, player role, genre, tone, and style.
2. Define season anchors: stakes, goal, inciting incident, climax.
3. Map the seven-point spine.
4. Define season promise architecture, central pressure, arcs, and information ownership.
5. Define the protagonist identity pressure and core NPC architecture.
6. Plan episodes with questions, structural roles, encounters, choice density, relationship beats, and forward pressure.
7. Plan scene graphs with bottlenecks, branch zones, transitions, and reconvergence.
8. Author scenes as turns, not summaries.
9. Author choices with type, intent, stakes, impact factors, consequence tier, conditions, consequences, and residue.
10. Author encounters with clocks, phases, choices, outcome trees, partial-victory costs, storylets, and visual contracts.
11. Package media contracts, style anchors, and asset references.
12. Save artifacts so repair can operate per stage or per episode.

### Critic pass

1. Try to break the story graph.
2. Try to prove choices are fake.
3. Try to prove branches reconverge by erasing the player.
4. Try to find mechanics in player-facing prose.
5. Try to find NPCs without independent motives.
6. Try to find scenes removable without consequence.
7. Try to find unplanted payoffs or unpaid plants.
8. Try to find impossible knowledge or canon contradictions.
9. Try to find source/treatment drift.
10. Try to find visual contradictions or inaccessible assets.
11. Run deterministic validators before relying on LLM critique.
12. Record advisory warnings instead of hiding them.
13. Repair the smallest artifact or episode scope that can fix the issue without damaging sealed upstream context.

## Short Form Rubric

When time is limited, ask these ten questions:

1. Does the player understand what they want and what it may cost?
2. Does every meaningful choice affect outcome, process, information, relationship, or identity?
3. Does the story remember what the player did?
4. Do branches change the experience and reconverge with residue?
5. Does every scene turn the situation?
6. Do NPCs want things, remember things, and change behavior?
7. Do hidden systems surface only through fiction?
8. Are setup, payoff, information, and canon tracked instead of guessed?
9. Do images and media tell the same story as the prose?
10. Can the package be loaded, played, validated, repaired, and exported safely?

If the answer to any question is "no," the story is not done.
